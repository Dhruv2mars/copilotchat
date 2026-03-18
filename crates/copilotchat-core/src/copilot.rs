use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use anyhow::{Result, anyhow};
use futures_util::StreamExt;
use reqwest::{Client, Response, header};
use serde::Deserialize;

use crate::{
    auth::StoredSession,
    models::{LiveModel, merge_models},
    types::{ChatMessage, ListedModel, MessageRole, StreamEvent, Usage},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceAuthorization {
    pub device_code: String,
    pub expires_at: String,
    pub interval_seconds: u64,
    pub organization: Option<String>,
    pub user_code: String,
    pub verification_uri: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceAuthorizationStatus {
    Complete(StoredSession),
    Pending { interval_seconds: u64 },
}

#[derive(Clone)]
pub struct GitHubCopilotClient {
    api_base_url: String,
    client_id: String,
    copilot_base_url: String,
    http: Client,
    login_base_url: String,
    model_cache: Arc<Mutex<HashMap<String, LiveModel>>>,
    scope: Option<String>,
}

pub struct GitHubCopilotClientOptions {
    pub api_base_url: String,
    pub client_id: String,
    pub copilot_base_url: String,
    pub login_base_url: String,
    pub scope: Option<String>,
}

impl GitHubCopilotClient {
    pub fn new() -> Self {
        Self::with_options(GitHubCopilotClientOptions {
            api_base_url: "https://api.github.com".to_string(),
            client_id: "Iv1.b507a08c87ecfe98".to_string(),
            copilot_base_url: "https://api.githubcopilot.com".to_string(),
            login_base_url: "https://github.com/login".to_string(),
            scope: None,
        })
    }

    pub fn with_options(options: GitHubCopilotClientOptions) -> Self {
        Self {
            api_base_url: options.api_base_url,
            client_id: options.client_id,
            copilot_base_url: options.copilot_base_url,
            http: Client::builder().build().expect("reqwest client"),
            login_base_url: options.login_base_url,
            model_cache: Arc::new(Mutex::new(HashMap::new())),
            scope: options.scope,
        }
    }

    pub async fn list_models(&self, token: &str) -> Result<Vec<ListedModel>> {
        let live_models = self.fetch_model_records(token).await?;
        Ok(merge_models(&live_models))
    }

    pub async fn refresh_session(&self, session: &StoredSession) -> Result<StoredSession> {
        let refresh_token = session
            .refresh_token
            .as_deref()
            .ok_or_else(|| anyhow!("auth_refresh_unavailable"))?;
        let payload = self
            .request_access_token(&[
                ("client_id", self.client_id.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .await?;
        let access_token = payload.access_token.ok_or_else(|| {
            anyhow!(
                payload
                    .error
                    .unwrap_or_else(|| "github_auth_refresh_failed".to_string())
            )
        })?;
        self.resolve_session(
            &access_token,
            session.organization.as_deref(),
            payload.expires_in,
            payload
                .refresh_token
                .or_else(|| session.refresh_token.clone()),
            payload.refresh_token_expires_in.or_else(|| {
                session
                    .refresh_token_expires_at
                    .as_deref()
                    .and_then(|value| value.parse::<u64>().ok())
            }),
        )
        .await
    }

    pub async fn poll_device_authorization(
        &self,
        device_code: &str,
        organization: Option<&str>,
    ) -> Result<DeviceAuthorizationStatus> {
        let payload = self
            .request_access_token(&[
                ("client_id", self.client_id.as_str()),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .await?;

        if matches!(
            payload.error.as_deref(),
            Some("authorization_pending") | Some("slow_down")
        ) {
            return Ok(DeviceAuthorizationStatus::Pending {
                interval_seconds: payload.interval.unwrap_or(5),
            });
        }

        let access_token = payload.access_token.ok_or_else(|| {
            anyhow!(
                payload
                    .error
                    .unwrap_or_else(|| "github_auth_failed".to_string())
            )
        })?;

        Ok(DeviceAuthorizationStatus::Complete(
            self.resolve_session(
                &access_token,
                organization,
                payload.expires_in,
                payload.refresh_token,
                payload.refresh_token_expires_in,
            )
            .await?,
        ))
    }

    pub async fn start_device_authorization(
        &self,
        organization: Option<&str>,
    ) -> Result<DeviceAuthorization> {
        let mut form = vec![("client_id", self.client_id.as_str())];
        if let Some(scope) = self.scope.as_deref() {
            form.push(("scope", scope));
        }
        let response = self
            .http
            .post(format!("{}/device/code", self.login_base_url))
            .header(header::ACCEPT, "application/json")
            .form(&form)
            .send()
            .await?;

        let status = response.status();
        let payload: DeviceCodePayload = response.json().await?;
        if !status.is_success() {
            return Err(anyhow!("github_device_code_failed"));
        }

        Ok(DeviceAuthorization {
            device_code: payload
                .device_code
                .ok_or_else(|| anyhow!("github_device_code_failed"))?,
            expires_at: seconds_from_now(payload.expires_in.unwrap_or(900)),
            interval_seconds: payload.interval.unwrap_or(5),
            organization: organization.map(str::to_string),
            user_code: payload
                .user_code
                .ok_or_else(|| anyhow!("github_device_code_failed"))?,
            verification_uri: payload
                .verification_uri
                .ok_or_else(|| anyhow!("github_device_code_failed"))?,
        })
    }

    pub async fn stream_chat<F>(
        &self,
        token: &str,
        _organization: Option<&str>,
        model_id: &str,
        messages: &[ChatMessage],
        mut on_event: F,
    ) -> Result<()>
    where
        F: FnMut(StreamEvent) -> Result<()>,
    {
        let endpoint_order = self.resolve_execution_shape(model_id);
        let mut last_error: Option<UpstreamError> = None;

        for endpoint in endpoint_order {
            match self
                .execute_endpoint(endpoint, token, model_id, messages, &mut on_event)
                .await
            {
                Ok(()) => return Ok(()),
                Err(error_value) => {
                    last_error = Some(error_value.clone());
                    if !should_try_next_endpoint(&error_value, endpoint) {
                        return Err(error_value.into());
                    }
                }
            }
        }

        Err(last_error
            .unwrap_or_else(|| UpstreamError::new(0, None, "github_copilot_request_failed"))
            .into())
    }
}

impl Default for GitHubCopilotClient {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Deserialize)]
struct AccessTokenPayload {
    access_token: Option<String>,
    error: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    refresh_token: Option<String>,
    refresh_token_expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChunk {
    choices: Option<Vec<ChatCompletionChoice>>,
    usage: Option<ChatUsage>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    delta: Option<ChatDelta>,
    message: Option<ChatDelta>,
}

#[derive(Debug, Deserialize)]
struct ChatDelta {
    content: Option<ChatContent>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ChatContent {
    Parts(Vec<TextPart>),
    Text(String),
}

#[derive(Debug, Deserialize)]
struct ChatUsage {
    completion_tokens: Option<u64>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    prompt_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DeviceCodePayload {
    device_code: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    user_code: Option<String>,
    verification_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubUser {
    login: String,
}

#[derive(Debug, Deserialize)]
struct ModelEnvelope {
    data: Vec<RemoteModelRecord>,
}

#[derive(Debug, Deserialize)]
struct RemoteCapabilities {
    family: Option<String>,
    #[serde(rename = "type")]
    model_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RemoteModelPolicy {
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RemoteModelRecord {
    capabilities: Option<RemoteCapabilities>,
    id: String,
    model_picker_enabled: Option<bool>,
    name: Option<String>,
    policy: Option<RemoteModelPolicy>,
    preview: Option<bool>,
    supported_endpoints: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct ResponsesCompleted {
    usage: Option<ResponsesUsage>,
}

#[derive(Debug, Deserialize)]
struct ResponsesContentItem {
    text: Option<String>,
    #[serde(rename = "type")]
    part_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResponsesItem {
    content: Option<Vec<ResponsesContentItem>>,
}

#[derive(Debug, Deserialize)]
struct ResponsesPayload {
    output: Option<Vec<ResponsesItem>>,
    usage: Option<ResponsesUsage>,
}

#[derive(Debug, Deserialize)]
struct ResponsesStreamEvent {
    delta: Option<String>,
    response: Option<ResponsesCompleted>,
    #[serde(rename = "type")]
    event_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResponsesUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TextPart {
    text: Option<String>,
    #[serde(rename = "type")]
    part_type: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeliveryMode {
    NonStream,
    Stream,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EndpointKind {
    Chat,
    Responses,
}

#[derive(Debug, Clone)]
struct UpstreamError {
    code: Option<String>,
    message: String,
    status: u16,
}

impl UpstreamError {
    fn new(status: u16, code: Option<String>, message: &str) -> Self {
        Self {
            code,
            message: message.to_string(),
            status,
        }
    }
}

impl std::fmt::Display for UpstreamError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for UpstreamError {}

impl GitHubCopilotClient {
    async fn complete_chat_completions<F>(
        &self,
        token: &str,
        model_id: &str,
        messages: &[ChatMessage],
        on_event: &mut F,
    ) -> std::result::Result<(), UpstreamError>
    where
        F: FnMut(StreamEvent) -> Result<()>,
    {
        let response = self
            .post_chat_completions(token, model_id, messages, false)
            .await?;
        let payload: ChatCompletionChunk = response
            .json()
            .await
            .map_err(|_| UpstreamError::new(0, None, "github_copilot_request_failed"))?;
        let content = payload
            .choices
            .and_then(|choices| choices.into_iter().next())
            .and_then(|choice| choice.message)
            .and_then(|message| message.content)
            .map(read_chat_content)
            .unwrap_or_default();
        if !content.is_empty() {
            on_event(StreamEvent::Delta(content))
                .map_err(|_| UpstreamError::new(0, None, "stream_handler_failed"))?;
        }
        on_event(StreamEvent::Done(Usage {
            input_tokens: payload
                .usage
                .as_ref()
                .and_then(|usage| usage.prompt_tokens.or(usage.input_tokens))
                .unwrap_or(0),
            output_tokens: payload
                .usage
                .as_ref()
                .and_then(|usage| usage.completion_tokens.or(usage.output_tokens))
                .unwrap_or(0),
        }))
        .map_err(|_| UpstreamError::new(0, None, "stream_handler_failed"))?;
        Ok(())
    }

    async fn complete_responses<F>(
        &self,
        token: &str,
        model_id: &str,
        messages: &[ChatMessage],
        on_event: &mut F,
    ) -> std::result::Result<(), UpstreamError>
    where
        F: FnMut(StreamEvent) -> Result<()>,
    {
        let response = self
            .post_responses(token, model_id, messages, false)
            .await?;
        let payload: ResponsesPayload = response
            .json()
            .await
            .map_err(|_| UpstreamError::new(0, None, "github_copilot_request_failed"))?;
        let content = payload
            .output
            .unwrap_or_default()
            .into_iter()
            .flat_map(|item| item.content.unwrap_or_default())
            .filter_map(|part| {
                if matches!(part.part_type.as_deref(), None | Some("output_text")) {
                    part.text
                } else {
                    None
                }
            })
            .collect::<String>();
        if !content.is_empty() {
            on_event(StreamEvent::Delta(content))
                .map_err(|_| UpstreamError::new(0, None, "stream_handler_failed"))?;
        }
        on_event(StreamEvent::Done(Usage {
            input_tokens: payload
                .usage
                .as_ref()
                .and_then(|usage| usage.input_tokens)
                .unwrap_or(0),
            output_tokens: payload
                .usage
                .as_ref()
                .and_then(|usage| usage.output_tokens)
                .unwrap_or(0),
        }))
        .map_err(|_| UpstreamError::new(0, None, "stream_handler_failed"))?;
        Ok(())
    }

    async fn connect(
        &self,
        token: &str,
        organization: Option<&str>,
        refresh_token: Option<String>,
        expires_in: Option<u64>,
        refresh_token_expires_in: Option<u64>,
    ) -> Result<StoredSession> {
        self.list_models(token).await?;
        let account_label = self
            .lookup_account_label(token)
            .await
            .unwrap_or_else(|_| "GitHub Copilot".to_string());

        Ok(StoredSession {
            account_label,
            expires_at: expires_in.map(seconds_from_now),
            organization: organization.map(str::to_string),
            refresh_token,
            refresh_token_expires_at: refresh_token_expires_in.map(seconds_from_now),
            token: token.to_string(),
            token_hint: mask_token(token),
        })
    }

    async fn lookup_account_label(&self, token: &str) -> Result<String> {
        let user_response = self
            .http
            .get(format!("{}/user", self.api_base_url))
            .headers(github_headers(token))
            .send()
            .await?;
        parse_github_user_body(&user_response.text().await?).map(|user| user.login)
    }

    async fn fetch_model_records(&self, token: &str) -> Result<Vec<LiveModel>> {
        let response = self
            .http
            .get(format!("{}/models", self.copilot_base_url))
            .headers(copilot_headers(token))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(read_error(response).await.into());
        }

        let text = response.text().await?;
        let records =
            if let Ok(array_payload) = serde_json::from_str::<Vec<RemoteModelRecord>>(&text) {
                array_payload
            } else {
                serde_json::from_str::<ModelEnvelope>(&text)
                    .map(|payload| payload.data)
                    .unwrap_or_default()
            };

        let live = records
            .into_iter()
            .map(|model| LiveModel {
                family: model
                    .capabilities
                    .as_ref()
                    .and_then(|caps| caps.family.clone()),
                id: model.id.clone(),
                label: model.name.unwrap_or_else(|| model.id.clone()),
                model_picker_enabled: model.model_picker_enabled.unwrap_or(false),
                policy_state: model.policy.and_then(|policy| policy.state),
                preview: model.preview.unwrap_or(false),
                supported_endpoints: model.supported_endpoints.unwrap_or_default(),
                model_type: model.capabilities.and_then(|caps| caps.model_type),
            })
            .collect::<Vec<_>>();

        if let Ok(mut cache) = self.model_cache.lock() {
            for model in &live {
                cache.insert(model.id.clone(), model.clone());
            }
        }

        Ok(live)
    }

    async fn post_chat_completions(
        &self,
        token: &str,
        model_id: &str,
        messages: &[ChatMessage],
        stream: bool,
    ) -> std::result::Result<Response, UpstreamError> {
        let response = self
            .http
            .post(format!("{}/chat/completions", self.copilot_base_url))
            .headers(copilot_headers(token))
            .json(&serde_json::json!({
              "messages": messages.iter().map(to_upstream_message).collect::<Vec<_>>(),
              "model": model_id,
              "stream": stream,
              "stream_options": if stream {
                serde_json::json!({ "include_usage": true })
              } else {
                serde_json::Value::Null
              }
            }))
            .send()
            .await
            .map_err(|_| UpstreamError::new(0, None, "github_copilot_request_failed"))?;

        if !response.status().is_success() {
            return Err(read_error(response).await);
        }
        Ok(response)
    }

    async fn post_responses(
        &self,
        token: &str,
        model_id: &str,
        messages: &[ChatMessage],
        stream: bool,
    ) -> std::result::Result<Response, UpstreamError> {
        let response = self
            .http
            .post(format!("{}/responses", self.copilot_base_url))
            .headers(copilot_headers(token))
            .json(&serde_json::json!({
              "input": messages.iter().map(to_responses_message).collect::<Vec<_>>(),
              "model": model_id,
              "stream": stream
            }))
            .send()
            .await
            .map_err(|_| UpstreamError::new(0, None, "github_copilot_request_failed"))?;

        if !response.status().is_success() {
            return Err(read_error(response).await);
        }
        Ok(response)
    }

    async fn request_access_token(&self, form: &[(&str, &str)]) -> Result<AccessTokenPayload> {
        let response = self
            .http
            .post(format!("{}/oauth/access_token", self.login_base_url))
            .header(header::ACCEPT, "application/json")
            .form(form)
            .send()
            .await?;
        let body = response.text().await?;
        parse_access_token_payload(&body)
    }

    async fn resolve_session(
        &self,
        access_token: &str,
        organization: Option<&str>,
        expires_in: Option<u64>,
        refresh_token: Option<String>,
        refresh_token_expires_in: Option<u64>,
    ) -> Result<StoredSession> {
        self.connect(
            access_token,
            organization,
            refresh_token,
            expires_in,
            refresh_token_expires_in,
        )
        .await
    }

    fn resolve_execution_shape(&self, model_id: &str) -> Vec<EndpointKind> {
        let model = self
            .model_cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(model_id).cloned());
        let supported = model.map_or_else(Vec::new, |model| model.supported_endpoints);

        if supported.is_empty() {
            return vec![EndpointKind::Chat, EndpointKind::Responses];
        }
        if supported.iter().any(|endpoint| endpoint == "/responses")
            && !supported
                .iter()
                .any(|endpoint| endpoint == "/chat/completions")
        {
            return vec![EndpointKind::Responses];
        }
        if supported
            .iter()
            .any(|endpoint| endpoint == "/chat/completions")
            && !supported.iter().any(|endpoint| endpoint == "/responses")
        {
            return vec![EndpointKind::Chat];
        }

        vec![EndpointKind::Chat, EndpointKind::Responses]
    }

    async fn stream_chat_completions<F>(
        &self,
        token: &str,
        model_id: &str,
        messages: &[ChatMessage],
        on_event: &mut F,
    ) -> std::result::Result<(), UpstreamError>
    where
        F: FnMut(StreamEvent) -> Result<()>,
    {
        let response = self
            .post_chat_completions(token, model_id, messages, true)
            .await?;
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut input_tokens = 0;
        let mut output_tokens = 0;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| UpstreamError::new(0, None, "stream_missing"))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            let (events, tail) = flush_frames(&buffer);
            buffer = tail;

            for payload in events {
                if payload == "[DONE]" {
                    continue;
                }
                let event: ChatCompletionChunk = serde_json::from_str(&payload)
                    .map_err(|_| UpstreamError::new(0, None, "github_copilot_request_failed"))?;
                if let Some(usage) = event.usage {
                    input_tokens = usage
                        .prompt_tokens
                        .or(usage.input_tokens)
                        .unwrap_or(input_tokens);
                    output_tokens = usage
                        .completion_tokens
                        .or(usage.output_tokens)
                        .unwrap_or(output_tokens);
                }

                if let Some(delta) = event
                    .choices
                    .and_then(|choices| choices.into_iter().next())
                    .and_then(|choice| choice.delta)
                    .and_then(|delta| delta.content)
                {
                    let content = read_chat_content(delta);
                    if !content.is_empty() {
                        on_event(StreamEvent::Delta(content))
                            .map_err(|_| UpstreamError::new(0, None, "stream_handler_failed"))?;
                    }
                }
            }
        }

        on_event(StreamEvent::Done(Usage {
            input_tokens,
            output_tokens,
        }))
        .map_err(|_| UpstreamError::new(0, None, "stream_handler_failed"))?;
        Ok(())
    }

    async fn stream_responses<F>(
        &self,
        token: &str,
        model_id: &str,
        messages: &[ChatMessage],
        on_event: &mut F,
    ) -> std::result::Result<(), UpstreamError>
    where
        F: FnMut(StreamEvent) -> Result<()>,
    {
        let response = self.post_responses(token, model_id, messages, true).await?;
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let mut input_tokens = 0;
        let mut output_tokens = 0;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| UpstreamError::new(0, None, "stream_missing"))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            let (events, tail) = flush_frames(&buffer);
            buffer = tail;

            for payload in events {
                let event: ResponsesStreamEvent = serde_json::from_str(&payload)
                    .map_err(|_| UpstreamError::new(0, None, "github_copilot_request_failed"))?;
                if event.event_type.as_deref() == Some("response.output_text.delta")
                    && let Some(delta) = event.delta
                {
                    on_event(StreamEvent::Delta(delta))
                        .map_err(|_| UpstreamError::new(0, None, "stream_handler_failed"))?;
                }
                if event.event_type.as_deref() == Some("response.completed") {
                    input_tokens = event
                        .response
                        .as_ref()
                        .and_then(|response| response.usage.as_ref())
                        .and_then(|usage| usage.input_tokens)
                        .unwrap_or(input_tokens);
                    output_tokens = event
                        .response
                        .as_ref()
                        .and_then(|response| response.usage.as_ref())
                        .and_then(|usage| usage.output_tokens)
                        .unwrap_or(output_tokens);
                }
            }
        }

        on_event(StreamEvent::Done(Usage {
            input_tokens,
            output_tokens,
        }))
        .map_err(|_| UpstreamError::new(0, None, "stream_handler_failed"))?;
        Ok(())
    }

    async fn execute_endpoint<F>(
        &self,
        endpoint: EndpointKind,
        token: &str,
        model_id: &str,
        messages: &[ChatMessage],
        on_event: &mut F,
    ) -> std::result::Result<(), UpstreamError>
    where
        F: FnMut(StreamEvent) -> Result<()>,
    {
        let stream_result = self
            .run_stream_attempts(endpoint, token, model_id, messages, on_event)
            .await;
        match stream_result {
            Ok(()) => Ok(()),
            Err(error_value) => {
                if should_try_non_streaming(&error_value, endpoint) {
                    match self
                        .run_non_stream_attempts(endpoint, token, model_id, messages, on_event)
                        .await
                    {
                        Ok(()) => Ok(()),
                        Err(non_stream_error) => Err(non_stream_error),
                    }
                } else {
                    Err(error_value)
                }
            }
        }
    }

    async fn run_non_stream_attempts<F>(
        &self,
        endpoint: EndpointKind,
        token: &str,
        model_id: &str,
        messages: &[ChatMessage],
        on_event: &mut F,
    ) -> std::result::Result<(), UpstreamError>
    where
        F: FnMut(StreamEvent) -> Result<()>,
    {
        let mut last_error = None;
        for attempt in 1..=3 {
            let result = match endpoint {
                EndpointKind::Chat => {
                    self.complete_chat_completions(token, model_id, messages, on_event)
                        .await
                }
                EndpointKind::Responses => {
                    self.complete_responses(token, model_id, messages, on_event)
                        .await
                }
            };

            match result {
                Ok(()) => return Ok(()),
                Err(error_value) => {
                    let retry = should_retry(&error_value, endpoint, DeliveryMode::NonStream)
                        && attempt < 3;
                    last_error = Some(error_value.clone());
                    if !retry {
                        return Err(error_value);
                    }
                }
            }
        }

        Err(last_error
            .unwrap_or_else(|| UpstreamError::new(0, None, "github_copilot_request_failed")))
    }

    async fn run_stream_attempts<F>(
        &self,
        endpoint: EndpointKind,
        token: &str,
        model_id: &str,
        messages: &[ChatMessage],
        on_event: &mut F,
    ) -> std::result::Result<(), UpstreamError>
    where
        F: FnMut(StreamEvent) -> Result<()>,
    {
        let mut last_error = None;
        for attempt in 1..=3 {
            let result = match endpoint {
                EndpointKind::Chat => {
                    self.stream_chat_completions(token, model_id, messages, on_event)
                        .await
                }
                EndpointKind::Responses => {
                    self.stream_responses(token, model_id, messages, on_event)
                        .await
                }
            };

            match result {
                Ok(()) => return Ok(()),
                Err(error_value) => {
                    let retry =
                        should_retry(&error_value, endpoint, DeliveryMode::Stream) && attempt < 3;
                    last_error = Some(error_value.clone());
                    if !retry {
                        return Err(error_value);
                    }
                }
            }
        }

        Err(last_error
            .unwrap_or_else(|| UpstreamError::new(0, None, "github_copilot_request_failed")))
    }
}

async fn read_error(response: Response) -> UpstreamError {
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let payload = serde_json::from_str::<serde_json::Value>(&text).ok();
    let code = payload
        .as_ref()
        .and_then(|value| value.get("error"))
        .and_then(|value| value.get("code"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let message = payload
        .as_ref()
        .and_then(|value| value.get("error"))
        .and_then(|value| value.get("message"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            payload
                .as_ref()
                .and_then(|value| value.get("message"))
                .and_then(serde_json::Value::as_str)
        })
        .unwrap_or("github_copilot_request_failed");

    UpstreamError::new(status, code, message)
}

fn copilot_headers(token: &str) -> header::HeaderMap {
    let mut headers = header::HeaderMap::new();
    headers.insert(
        header::ACCEPT,
        header::HeaderValue::from_static("application/json"),
    );
    headers.insert(
        header::AUTHORIZATION,
        header::HeaderValue::from_str(&format!("Bearer {token}")).expect("authorization header"),
    );
    headers.insert(
        header::HeaderName::from_static("copilot-integration-id"),
        header::HeaderValue::from_static("vscode-chat"),
    );
    headers.insert(
        header::HeaderName::from_static("editor-plugin-version"),
        header::HeaderValue::from_static("copilot-chat/0.30.0"),
    );
    headers.insert(
        header::HeaderName::from_static("editor-version"),
        header::HeaderValue::from_static("vscode/1.106.0"),
    );
    headers
}

fn flush_frames(buffer: &str) -> (Vec<String>, String) {
    let mut frames = buffer.split("\n\n").map(str::to_string).collect::<Vec<_>>();
    let tail = frames.pop().unwrap_or_default();
    let events = frames
        .into_iter()
        .map(|frame| {
            frame
                .lines()
                .filter(|line| line.starts_with("data: "))
                .map(|line| line.trim_start_matches("data: "))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|payload| !payload.is_empty())
        .collect::<Vec<_>>();

    (events, tail)
}

fn github_headers(token: &str) -> header::HeaderMap {
    let mut headers = header::HeaderMap::new();
    headers.insert(
        header::ACCEPT,
        header::HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(
        header::AUTHORIZATION,
        header::HeaderValue::from_str(&format!("Bearer {token}")).expect("authorization header"),
    );
    headers.insert(
        header::HeaderName::from_static("x-github-api-version"),
        header::HeaderValue::from_static("2022-11-28"),
    );
    headers
}

fn is_unsupported_endpoint(error: &UpstreamError, endpoint: EndpointKind) -> bool {
    if error.code.as_deref() != Some("unsupported_api_for_model") {
        return false;
    }
    match endpoint {
        EndpointKind::Chat => error.message.contains("/chat/completions"),
        EndpointKind::Responses => error.message.contains("Responses API"),
    }
}

fn is_unsupported_model(error: &UpstreamError) -> bool {
    error.code.as_deref() == Some("model_not_supported")
}

fn mask_token(token: &str) -> String {
    if token.len() <= 8 {
        token.to_string()
    } else {
        format!("{}...{}", &token[..4], &token[token.len() - 4..])
    }
}

fn read_chat_content(content: ChatContent) -> String {
    match content {
        ChatContent::Text(text) => text,
        ChatContent::Parts(parts) => parts
            .into_iter()
            .filter_map(|part| {
                if matches!(part.part_type.as_deref(), None | Some("text")) {
                    part.text
                } else {
                    None
                }
            })
            .collect::<String>(),
    }
}

fn seconds_from_now(seconds: u64) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    (SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time after epoch")
        .as_secs()
        + seconds)
        .to_string()
}

fn parse_access_token_payload(body: &str) -> Result<AccessTokenPayload> {
    if let Ok(payload) = serde_json::from_str::<AccessTokenPayload>(body) {
        return Ok(payload);
    }

    let params = url::form_urlencoded::parse(body.trim().as_bytes())
        .into_owned()
        .collect::<HashMap<String, String>>();

    if params.is_empty() {
        return Err(anyhow!("github_auth_failed"));
    }

    Ok(AccessTokenPayload {
        access_token: params.get("access_token").cloned(),
        error: params.get("error").cloned(),
        expires_in: params
            .get("expires_in")
            .and_then(|value| value.parse::<u64>().ok()),
        interval: params
            .get("interval")
            .and_then(|value| value.parse::<u64>().ok()),
        refresh_token: params.get("refresh_token").cloned(),
        refresh_token_expires_in: params
            .get("refresh_token_expires_in")
            .and_then(|value| value.parse::<u64>().ok()),
    })
}

fn parse_github_user_body(body: &str) -> Result<GitHubUser> {
    let trimmed = body.trim();
    if let Ok(user) = serde_json::from_str::<GitHubUser>(trimmed) {
        return Ok(user);
    }

    for line in trimmed.lines() {
        let candidate = line.trim();
        if candidate.is_empty() {
            continue;
        }
        if let Ok(user) = serde_json::from_str::<GitHubUser>(candidate) {
            return Ok(user);
        }
    }

    Err(anyhow!("github_user_lookup_failed"))
}

fn should_retry(error: &UpstreamError, endpoint: EndpointKind, mode: DeliveryMode) -> bool {
    if is_unsupported_endpoint(error, endpoint) {
        return false;
    }
    if matches!(mode, DeliveryMode::Stream)
        && matches!(endpoint, EndpointKind::Chat)
        && is_unsupported_model(error)
    {
        return true;
    }
    if matches!(mode, DeliveryMode::NonStream)
        && matches!(endpoint, EndpointKind::Responses)
        && is_unsupported_model(error)
    {
        return false;
    }
    matches!(
        error.status,
        403 | 408 | 409 | 425 | 429 | 500 | 502 | 503 | 504
    )
}

fn should_try_next_endpoint(error: &UpstreamError, endpoint: EndpointKind) -> bool {
    matches!(endpoint, EndpointKind::Chat)
        && (is_unsupported_model(error) || is_unsupported_endpoint(error, endpoint))
}

fn should_try_non_streaming(error: &UpstreamError, endpoint: EndpointKind) -> bool {
    error.status == 403
        || (matches!(endpoint, EndpointKind::Responses) && is_unsupported_model(error))
}

fn to_responses_message(message: &ChatMessage) -> serde_json::Value {
    serde_json::json!({
      "content": [{
        "text": message.content,
        "type": if matches!(message.role, MessageRole::Assistant) {
          "output_text"
        } else {
          "input_text"
        }
      }],
      "role": role_name(&message.role)
    })
}

fn to_upstream_message(message: &ChatMessage) -> serde_json::Value {
    serde_json::json!({
      "content": message.content,
      "role": role_name(&message.role)
    })
}

fn role_name(role: &MessageRole) -> &'static str {
    match role {
        MessageRole::Assistant => "assistant",
        MessageRole::System => "system",
        MessageRole::User => "user",
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_string_contains, method, path},
    };

    use crate::types::{ChatMessage, MessageRole, StreamEvent};

    use super::{DeviceAuthorizationStatus, GitHubCopilotClient, GitHubCopilotClientOptions};
    use super::{parse_access_token_payload, parse_github_user_body};

    #[tokio::test]
    async fn starts_device_auth_polls_and_streams_chat() {
        let github = MockServer::start().await;
        let copilot = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/device/code"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
              "device_code": "dev-code",
              "expires_in": 900,
              "interval": 5,
              "user_code": "ABCD-EFGH",
              "verification_uri": "https://github.com/login/device"
            })))
            .mount(&github)
            .await;
        Mock::given(method("POST"))
            .and(path("/oauth/access_token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
              "access_token": "ghu_1234567890",
              "expires_in": 3600,
              "refresh_token": "refresh-token",
              "refresh_token_expires_in": 7200
            })))
            .mount(&github)
            .await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                  "capabilities": { "family": "gpt-5.2", "type": "chat" },
                  "id": "gpt-5.2",
                  "name": "GPT-5.2",
                  "model_picker_enabled": true,
                  "policy": { "state": "enabled" },
                  "supported_endpoints": ["/chat/completions"]
                }])),
            )
            .mount(&copilot)
            .await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
              "login": "dhruv2mars"
            })))
            .mount(&github)
            .await;
        Mock::given(method("POST"))
      .and(path("/chat/completions"))
      .and(body_string_contains("gpt-5.2"))
      .respond_with(ResponseTemplate::new(200).set_body_string(
        "data: {\"choices\":[{\"delta\":{\"content\":\"New \"}}]}\n\n\
         data: {\"choices\":[{\"delta\":{\"content\":\"Delhi\"}}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n\
         data: [DONE]\n\n",
      ))
      .mount(&copilot)
      .await;

        let client = GitHubCopilotClient::with_options(GitHubCopilotClientOptions {
            api_base_url: github.uri(),
            client_id: "client-id".into(),
            copilot_base_url: copilot.uri(),
            login_base_url: github.uri(),
            scope: None,
        });

        let device = client
            .start_device_authorization(Some("acme"))
            .await
            .expect("device start");
        assert_eq!(device.device_code, "dev-code");
        assert_eq!(device.organization.as_deref(), Some("acme"));

        let status = client
            .poll_device_authorization("dev-code", Some("acme"))
            .await
            .expect("device poll");
        let session = match status {
            DeviceAuthorizationStatus::Complete(session) => session,
            DeviceAuthorizationStatus::Pending { .. } => panic!("expected complete"),
        };

        assert_eq!(session.account_label, "dhruv2mars");
        assert_eq!(session.organization.as_deref(), Some("acme"));
        assert_eq!(session.refresh_token.as_deref(), Some("refresh-token"));
        assert_eq!(session.token, "ghu_1234567890");
        assert_eq!(session.token_hint, "ghu_...7890");

        let events = Arc::new(Mutex::new(Vec::new()));
        let events_clone = Arc::clone(&events);
        client
            .stream_chat(
                "ghu_1234567890",
                Some("acme"),
                "gpt-5.2",
                &[ChatMessage {
                    content: "indian capital city?".into(),
                    id: "msg-1".into(),
                    role: MessageRole::User,
                }],
                move |event| {
                    events_clone.lock().expect("events lock").push(event);
                    Ok(())
                },
            )
            .await
            .expect("stream chat");

        assert_eq!(
            events.lock().expect("events lock").clone(),
            vec![
                StreamEvent::Delta("New ".into()),
                StreamEvent::Delta("Delhi".into()),
                StreamEvent::Done(crate::types::Usage {
                    input_tokens: 3,
                    output_tokens: 2,
                }),
            ]
        );
    }

    #[test]
    fn parses_json_and_form_encoded_access_token_payloads() {
        let json_payload = parse_access_token_payload(
            r#"{"access_token":"token-1","refresh_token":"refresh-1","expires_in":3600}"#,
        )
        .expect("json payload");
        assert_eq!(json_payload.access_token.as_deref(), Some("token-1"));
        assert_eq!(json_payload.refresh_token.as_deref(), Some("refresh-1"));
        assert_eq!(json_payload.expires_in, Some(3600));

        let form_payload = parse_access_token_payload(
            "access_token=token-2&refresh_token=refresh-2&expires_in=1800&interval=5",
        )
        .expect("form payload");
        assert_eq!(form_payload.access_token.as_deref(), Some("token-2"));
        assert_eq!(form_payload.refresh_token.as_deref(), Some("refresh-2"));
        assert_eq!(form_payload.expires_in, Some(1800));
        assert_eq!(form_payload.interval, Some(5));
    }

    #[test]
    fn parses_github_user_from_clean_or_multiline_json() {
        let clean = parse_github_user_body(r#"{"login":"dhruv2mars"}"#).expect("clean user");
        assert_eq!(clean.login, "dhruv2mars");

        let multiline = parse_github_user_body("{\"login\":\"dhruv2mars\"}\n\nignored")
            .expect("multiline user");
        assert_eq!(multiline.login, "dhruv2mars");
    }

    #[tokio::test]
    async fn falls_back_to_generic_account_label_when_github_user_lookup_is_unusable() {
        let github = MockServer::start().await;
        let copilot = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!([{
                    "capabilities": { "family": "gpt-5.2", "type": "chat" },
                    "id": "gpt-5.2",
                    "name": "GPT-5.2",
                    "model_picker_enabled": true,
                    "policy": { "state": "enabled" },
                    "supported_endpoints": ["/chat/completions"]
                }])),
            )
            .mount(&copilot)
            .await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not-json"))
            .mount(&github)
            .await;

        let client = GitHubCopilotClient::with_options(GitHubCopilotClientOptions {
            api_base_url: github.uri(),
            client_id: "client-id".into(),
            copilot_base_url: copilot.uri(),
            login_base_url: github.uri(),
            scope: None,
        });

        let session = client
            .connect("ghu_1234567890", Some("acme"), None, Some(3600), None)
            .await
            .expect("connect with fallback");

        assert_eq!(session.account_label, "GitHub Copilot");
        assert_eq!(session.token_hint, "ghu_...7890");
    }
}
