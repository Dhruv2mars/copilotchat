use clap::{Parser, Subcommand};
use std::io::{self, Write};

use anyhow::{Result, anyhow};
use copilotchat_core::{
    auth::{KeyringSecretStore, SessionStore, StoredSession, session_needs_refresh},
    config::AppPaths,
    copilot::{DeviceAuthorizationStatus, GitHubCopilotClient},
    history::ThreadStore,
    types::{AppConfig, ChatMessage, ListedModel, MessageRole, ModelAvailability},
};
use uuid::Uuid;

mod tui;

#[derive(Debug, Parser)]
#[command(name = "copilotchat")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum Command {
    Auth {
        #[command(subcommand)]
        command: AuthCommand,
    },
    Chat {
        prompt: String,
    },
    Models,
}

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum AuthCommand {
    Login,
    Logout,
    Status,
}

pub async fn run(cli: Cli) -> Result<()> {
    let client = GitHubCopilotClient::new();
    match cli.command {
        Some(Command::Auth { command }) => run_auth_command(&client, command).await,
        Some(Command::Chat { prompt }) => run_chat_command(&client, prompt).await,
        Some(Command::Models) => run_models_command(&client).await,
        None => tui::run_tui(client).await,
    }
}

pub async fn load_session(client: &GitHubCopilotClient) -> Result<StoredSession> {
    let store = session_store()?;
    let session = store.load()?.ok_or_else(|| anyhow!("auth_required"))?;
    if session_needs_refresh(&session) {
        let refreshed = client.refresh_session(&session).await?;
        store.save(&refreshed)?;
        return Ok(refreshed);
    }
    Ok(session)
}

pub fn session_store() -> Result<SessionStore<KeyringSecretStore>> {
    Ok(SessionStore::new(KeyringSecretStore::new()?))
}

pub async fn thread_store() -> Result<ThreadStore> {
    Ok(ThreadStore::new(AppPaths::detect()?))
}

pub fn choose_model(config: &AppConfig, models: &[ListedModel]) -> Result<String> {
    if let Some(current_model_id) = &config.current_model_id
        && models.iter().any(|model| {
            model.id == *current_model_id && model.availability == ModelAvailability::Available
        })
    {
        return Ok(current_model_id.clone());
    }

    models
        .iter()
        .find(|model| model.availability == ModelAvailability::Available)
        .map(|model| model.id.clone())
        .ok_or_else(|| anyhow!("no_available_models"))
}

async fn run_auth_command(client: &GitHubCopilotClient, command: AuthCommand) -> Result<()> {
    match command {
        AuthCommand::Login => {
            let device = client.start_device_authorization(None).await?;
            println!("Open: {}", device.verification_uri);
            println!("Code: {}", device.user_code);
            let _ = open::that(&device.verification_uri);

            let mut wait_seconds = device.interval_seconds;
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(wait_seconds)).await;
                match client
                    .poll_device_authorization(&device.device_code, device.organization.as_deref())
                    .await?
                {
                    DeviceAuthorizationStatus::Pending { interval_seconds } => {
                        wait_seconds = interval_seconds;
                    }
                    DeviceAuthorizationStatus::Complete(session) => {
                        session_store()?.save(&session)?;
                        println!("Connected: {}", session.account_label);
                        return Ok(());
                    }
                }
            }
        }
        AuthCommand::Logout => {
            session_store()?.clear()?;
            println!("Logged out");
            Ok(())
        }
        AuthCommand::Status => match session_store()?.load()? {
            Some(session) => {
                println!("Connected: {}", session.account_label);
                Ok(())
            }
            None => {
                println!("Disconnected");
                Ok(())
            }
        },
    }
}

async fn run_chat_command(client: &GitHubCopilotClient, prompt: String) -> Result<()> {
    let session = load_session(client).await?;
    let store = thread_store().await?;
    let models = client.list_models(&session.token).await?;
    let mut config = store.load_config().await?;
    let model_id = choose_model(&config, &models)?;
    let thread_id = config
        .current_thread_id
        .clone()
        .unwrap_or_else(|| format!("thread-{}", Uuid::new_v4()));
    let user_message = ChatMessage {
        content: prompt,
        id: format!("msg-{}", Uuid::new_v4()),
        role: MessageRole::User,
    };

    let mut thread = store
        .append_to_thread(&thread_id, &model_id, user_message)
        .await?;
    let request_messages = thread.messages.clone();
    thread.messages.push(ChatMessage {
        content: String::new(),
        id: format!("msg-{}", Uuid::new_v4()),
        role: MessageRole::Assistant,
    });
    store.save_thread(&thread).await?;

    config.current_model_id = Some(model_id.clone());
    config.current_thread_id = Some(thread_id);
    store.save_config(&config).await?;

    let mut assistant = String::new();
    client
        .stream_chat(
            &session.token,
            session.organization.as_deref(),
            &model_id,
            &request_messages,
            |event| {
                if let copilotchat_core::types::StreamEvent::Delta(delta) = event {
                    print!("{delta}");
                    io::stdout().flush()?;
                    assistant.push_str(&delta);
                }
                Ok(())
            },
        )
        .await?;
    println!();

    if let Some(last_message) = thread.messages.last_mut() {
        last_message.content = assistant;
    }
    store.save_thread(&thread).await?;

    Ok(())
}

async fn run_models_command(client: &GitHubCopilotClient) -> Result<()> {
    let session = load_session(client).await?;
    let models = client.list_models(&session.token).await?;
    for model in models {
        let status = match model.availability {
            ModelAvailability::Available => "available",
            ModelAvailability::Unsupported => "unsupported",
        };
        println!("{status}\t{}\t{}", model.id, model.label);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use crate::{AuthCommand, Cli, Command, choose_model};
    use copilotchat_core::types::{AppConfig, ListedModel, ModelAvailability};

    #[test]
    fn parses_chat_and_auth_commands() {
        let chat = Cli::parse_from(["copilotchat", "chat", "indian capital city?"]);
        assert_eq!(
            chat.command,
            Some(Command::Chat {
                prompt: "indian capital city?".into()
            })
        );

        let auth = Cli::parse_from(["copilotchat", "auth", "status"]);
        assert_eq!(
            auth.command,
            Some(Command::Auth {
                command: AuthCommand::Status
            })
        );
    }

    #[test]
    fn chooses_current_model_or_first_available_model() {
        let models = vec![
            ListedModel {
                availability: ModelAvailability::Unsupported,
                id: "gpt-5.4".into(),
                label: "GPT-5.4".into(),
            },
            ListedModel {
                availability: ModelAvailability::Available,
                id: "gpt-5.2".into(),
                label: "GPT-5.2".into(),
            },
        ];

        assert_eq!(
            choose_model(
                &AppConfig {
                    current_model_id: Some("gpt-5.2".into()),
                    current_thread_id: None
                },
                &models
            )
            .expect("choose current"),
            "gpt-5.2"
        );

        assert_eq!(
            choose_model(
                &AppConfig {
                    current_model_id: Some("gpt-5.4".into()),
                    current_thread_id: None
                },
                &models
            )
            .expect("choose fallback"),
            "gpt-5.2"
        );
    }
}
