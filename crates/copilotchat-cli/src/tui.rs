use std::{io, time::Duration};

use anyhow::Result;
use copilotchat_core::{
    auth::StoredSession,
    copilot::{DeviceAuthorization, DeviceAuthorizationStatus, GitHubCopilotClient},
    history::ThreadStore,
    types::{AppConfig, ChatMessage, ListedModel, MessageRole, StreamEvent, ThreadSummary},
};
use crossterm::{
    event::{Event, EventStream, KeyCode, KeyEvent, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use futures_util::StreamExt;
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap},
};
use tokio::{sync::mpsc, task::JoinHandle};
use tui_textarea::{Input, Key, TextArea};
use uuid::Uuid;

use crate::{choose_model, load_session, session_store, thread_store};

enum AppEvent {
    AuthComplete(StoredSession),
    AuthError(String),
    ChatDone(String),
    ChatError(String),
    ChatStream(StreamEvent),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Focus {
    Composer,
    Models,
    Threads,
}

struct App {
    auth_prompt: Option<DeviceAuthorization>,
    composer: TextArea<'static>,
    config: AppConfig,
    current_thread_id: Option<String>,
    focus: Focus,
    messages: Vec<ChatMessage>,
    model_cursor: usize,
    model_query: String,
    models: Vec<ListedModel>,
    session: Option<StoredSession>,
    status: String,
    stream_task: Option<JoinHandle<()>>,
    thread_cursor: usize,
    threads: Vec<ThreadSummary>,
}

impl App {
    fn new(config: AppConfig, threads: Vec<ThreadSummary>) -> Self {
        let mut composer = TextArea::default();
        composer.set_block(Block::default().title("Composer").borders(Borders::ALL));
        Self {
            auth_prompt: None,
            composer,
            config,
            current_thread_id: None,
            focus: Focus::Composer,
            messages: Vec::new(),
            model_cursor: 0,
            model_query: String::new(),
            models: Vec::new(),
            session: None,
            status: "Ready".into(),
            stream_task: None,
            thread_cursor: 0,
            threads,
        }
    }

    fn current_model_id(&self) -> Option<&str> {
        self.config.current_model_id.as_deref()
    }

    fn filtered_models(&self) -> Vec<&ListedModel> {
        let query = self.model_query.to_lowercase();
        self.models
            .iter()
            .filter(|model| {
                query.is_empty()
                    || model.id.to_lowercase().contains(&query)
                    || model.label.to_lowercase().contains(&query)
            })
            .collect()
    }

    fn has_session(&self) -> bool {
        self.session.is_some()
    }

    fn is_streaming(&self) -> bool {
        self.stream_task.is_some()
    }

    fn next_focus(&mut self) {
        self.focus = match self.focus {
            Focus::Composer => Focus::Models,
            Focus::Models => Focus::Threads,
            Focus::Threads => Focus::Composer,
        };
    }

    fn set_current_thread(&mut self, thread: Option<&ThreadSummary>) {
        self.current_thread_id = thread.map(|value| value.id.clone());
        self.config.current_thread_id = self.current_thread_id.clone();
    }
}

pub async fn run_tui(client: GitHubCopilotClient) -> Result<()> {
    let store = thread_store().await?;
    let mut app = App::new(store.load_config().await?, store.list_threads().await?);
    if let Ok(session) = load_session(&client).await {
        app.session = Some(session.clone());
        app.models = client.list_models(&session.token).await?;
        app.config.current_model_id = Some(choose_model(&app.config, &app.models)?);
    }
    if let Some(thread_id) = app.config.current_thread_id.clone() {
        if let Ok(thread) = store.thread(&thread_id).await {
            app.current_thread_id = Some(thread_id);
            app.messages = thread.messages;
        }
    } else if let Some(first_thread) = app.threads.first().cloned() {
        app.set_current_thread(Some(&first_thread));
        let thread = store.thread(&first_thread.id).await?;
        app.messages = thread.messages;
    }

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<AppEvent>();
    let mut reader = EventStream::new();
    let result = run_loop(
        &mut terminal,
        &client,
        &store,
        &mut app,
        &event_tx,
        &mut event_rx,
        &mut reader,
    )
    .await;
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

async fn run_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    client: &GitHubCopilotClient,
    store: &ThreadStore,
    app: &mut App,
    event_tx: &mpsc::UnboundedSender<AppEvent>,
    event_rx: &mut mpsc::UnboundedReceiver<AppEvent>,
    reader: &mut EventStream,
) -> Result<()> {
    loop {
        terminal.draw(|frame| render(frame.area(), frame, app))?;

        tokio::select! {
        maybe_event = reader.next() => {
            if let Some(Ok(Event::Key(key_event))) = maybe_event
                && handle_key_event(key_event, client, store, app, event_tx).await?
            {
                return Ok(());
            }
        }
          maybe_app_event = event_rx.recv() => {
            if let Some(app_event) = maybe_app_event {
              handle_app_event(client, store, app, app_event).await?;
            }
          }
          _ = tokio::time::sleep(Duration::from_millis(120)) => {}
        }
    }
}

async fn handle_app_event(
    client: &GitHubCopilotClient,
    store: &ThreadStore,
    app: &mut App,
    event: AppEvent,
) -> Result<()> {
    match event {
        AppEvent::AuthComplete(session) => {
            session_store()?.save(&session)?;
            app.session = Some(session.clone());
            app.auth_prompt = None;
            app.models = client.list_models(&session.token).await?;
            app.config.current_model_id = Some(choose_model(&app.config, &app.models)?);
            store.save_config(&app.config).await?;
            app.status = format!("Connected: {}", session.account_label);
        }
        AppEvent::AuthError(message) => {
            app.auth_prompt = None;
            app.status = message;
        }
        AppEvent::ChatDone(message) => {
            app.stream_task = None;
            app.status = message;
            persist_current_thread(store, app).await?;
        }
        AppEvent::ChatError(message) => {
            app.stream_task = None;
            app.status = message;
            persist_current_thread(store, app).await?;
        }
        AppEvent::ChatStream(stream_event) => match stream_event {
            StreamEvent::Delta(delta) => {
                if let Some(last_message) = app.messages.last_mut() {
                    last_message.content.push_str(&delta);
                }
                persist_current_thread(store, app).await?;
            }
            StreamEvent::Done(usage) => {
                app.stream_task = None;
                app.status = format!(
                    "Done: {} in / {} out",
                    usage.input_tokens, usage.output_tokens
                );
                persist_current_thread(store, app).await?;
            }
        },
    }
    Ok(())
}

async fn handle_key_event(
    key_event: KeyEvent,
    client: &GitHubCopilotClient,
    store: &ThreadStore,
    app: &mut App,
    event_tx: &mpsc::UnboundedSender<AppEvent>,
) -> Result<bool> {
    if key_event.modifiers.contains(KeyModifiers::CONTROL) && key_event.code == KeyCode::Char('c') {
        return Ok(true);
    }
    if key_event.code == KeyCode::Char('q') && !app.is_streaming() {
        return Ok(true);
    }
    if key_event.code == KeyCode::Esc && app.is_streaming() {
        if let Some(task) = app.stream_task.take() {
            task.abort();
        }
        app.status = "Stream cancelled".into();
        return Ok(false);
    }

    if !app.has_session() {
        if matches!(key_event.code, KeyCode::Enter | KeyCode::Char('l')) {
            start_login(client.clone(), app, event_tx.clone()).await?;
        }
        return Ok(false);
    }

    if key_event.code == KeyCode::Tab {
        app.next_focus();
        return Ok(false);
    }

    match app.focus {
        Focus::Composer => handle_composer_key(key_event, client, store, app, event_tx).await?,
        Focus::Models => handle_model_key(key_event, store, app).await?,
        Focus::Threads => handle_thread_key(key_event, store, app).await?,
    }
    Ok(false)
}

async fn handle_composer_key(
    key_event: KeyEvent,
    client: &GitHubCopilotClient,
    store: &ThreadStore,
    app: &mut App,
    event_tx: &mpsc::UnboundedSender<AppEvent>,
) -> Result<()> {
    if key_event.code == KeyCode::Enter && !key_event.modifiers.contains(KeyModifiers::SHIFT) {
        if app.is_streaming() {
            return Ok(());
        }
        send_message(client.clone(), store, app, event_tx.clone()).await?;
        return Ok(());
    }

    app.composer.input(key_event_to_input(key_event));
    Ok(())
}

async fn handle_model_key(key_event: KeyEvent, store: &ThreadStore, app: &mut App) -> Result<()> {
    let filtered = app.filtered_models();
    match key_event.code {
        KeyCode::Backspace => {
            app.model_query.pop();
            app.model_cursor = 0;
        }
        KeyCode::Char(value) => {
            if key_event.modifiers.is_empty() || key_event.modifiers == KeyModifiers::SHIFT {
                app.model_query.push(value);
                app.model_cursor = 0;
            }
        }
        KeyCode::Down => {
            if !filtered.is_empty() {
                app.model_cursor = (app.model_cursor + 1).min(filtered.len().saturating_sub(1));
            }
        }
        KeyCode::Up => {
            app.model_cursor = app.model_cursor.saturating_sub(1);
        }
        KeyCode::Enter => {
            if let Some(model) = filtered.get(app.model_cursor) {
                let model_id = model.id.clone();
                let model_label = model.label.clone();
                app.config.current_model_id = Some(model_id);
                store.save_config(&app.config).await?;
                app.status = format!("Model: {model_label}");
            }
        }
        KeyCode::Esc => {
            app.model_query.clear();
            app.model_cursor = 0;
        }
        _ => {}
    }
    Ok(())
}

async fn handle_thread_key(key_event: KeyEvent, store: &ThreadStore, app: &mut App) -> Result<()> {
    match key_event.code {
        KeyCode::Char('n') => {
            app.current_thread_id = Some(format!("thread-{}", Uuid::new_v4()));
            app.config.current_thread_id = app.current_thread_id.clone();
            app.messages.clear();
            store.save_config(&app.config).await?;
            app.status = "New thread".into();
        }
        KeyCode::Char('d') => {
            if let Some(thread) = app.threads.get(app.thread_cursor).cloned() {
                store.delete_thread(&thread.id).await?;
                app.threads = store.list_threads().await?;
                app.thread_cursor = app.thread_cursor.min(app.threads.len().saturating_sub(1));
                if let Some(next_thread) = app.threads.get(app.thread_cursor).cloned() {
                    app.set_current_thread(Some(&next_thread));
                    app.messages = store.thread(&next_thread.id).await?.messages;
                } else {
                    app.set_current_thread(None);
                    app.messages.clear();
                }
                store.save_config(&app.config).await?;
                app.status = "Thread deleted".into();
            }
        }
        KeyCode::Down => {
            if !app.threads.is_empty() {
                app.thread_cursor =
                    (app.thread_cursor + 1).min(app.threads.len().saturating_sub(1));
            }
        }
        KeyCode::Up => {
            app.thread_cursor = app.thread_cursor.saturating_sub(1);
        }
        KeyCode::Enter => {
            if let Some(thread) = app.threads.get(app.thread_cursor).cloned() {
                app.set_current_thread(Some(&thread));
                app.messages = store.thread(&thread.id).await?.messages;
                store.save_config(&app.config).await?;
                app.status = format!("Thread: {}", thread.title);
            }
        }
        _ => {}
    }
    Ok(())
}

async fn persist_current_thread(store: &ThreadStore, app: &App) -> Result<()> {
    let Some(thread_id) = app.current_thread_id.clone() else {
        return Ok(());
    };
    let Some(model_id) = app.config.current_model_id.clone() else {
        return Ok(());
    };
    if app.messages.is_empty() {
        return Ok(());
    }

    let thread = copilotchat_core::types::ThreadRecord {
        created_at: app
            .threads
            .iter()
            .find(|thread| thread.id == thread_id)
            .map(|thread| thread.updated_at.clone())
            .unwrap_or_else(|| "0".into()),
        id: thread_id,
        messages: app.messages.clone(),
        model_id,
        title: app
            .messages
            .iter()
            .find(|message| matches!(message.role, MessageRole::User))
            .map(|message| message.content.chars().take(48).collect::<String>())
            .unwrap_or_else(|| "New chat".into()),
        updated_at: current_timestamp(),
    };
    store.save_thread(&thread).await?;
    Ok(())
}

fn current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time after epoch")
        .as_secs()
        .to_string()
}

fn render(area: Rect, frame: &mut ratatui::Frame<'_>, app: &App) {
    if !app.has_session() {
        let block = Block::default()
            .title("Connect GitHub Copilot")
            .borders(Borders::ALL);
        let content = if let Some(auth_prompt) = &app.auth_prompt {
            vec![
                Line::from("Open GitHub device activation."),
                Line::from(Span::raw(format!("URL: {}", auth_prompt.verification_uri))),
                Line::from(Span::styled(
                    format!("Code: {}", auth_prompt.user_code),
                    Style::default().add_modifier(Modifier::BOLD),
                )),
                Line::from("Waiting for approval..."),
            ]
        } else {
            vec![
                Line::from("Press Enter to connect GitHub Copilot."),
                Line::from("Browser will open automatically."),
            ]
        };
        let paragraph = Paragraph::new(content)
            .block(block)
            .wrap(Wrap { trim: true });
        frame.render_widget(Clear, area);
        frame.render_widget(paragraph, centered_rect(area, 70, 35));
        return;
    }

    let layout = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(28), Constraint::Min(50)])
        .split(area);
    let sidebar = layout[0];
    let content = layout[1];
    let right = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(10),
            Constraint::Min(10),
            Constraint::Length(5),
            Constraint::Length(1),
        ])
        .split(content);

    let thread_items = app
        .threads
        .iter()
        .enumerate()
        .map(|(index, thread)| {
            let style = if index == app.thread_cursor && app.focus == Focus::Threads {
                Style::default().fg(Color::Black).bg(Color::Cyan)
            } else {
                Style::default()
            };
            ListItem::new(Line::from(thread.title.clone())).style(style)
        })
        .collect::<Vec<_>>();
    frame.render_widget(
        List::new(thread_items).block(Block::default().title("Threads").borders(Borders::ALL)),
        sidebar,
    );

    let models = app.filtered_models();
    let mut model_lines = vec![Line::from(format!(
        "Search: {}",
        if app.model_query.is_empty() {
            ""
        } else {
            &app.model_query
        }
    ))];
    for (index, model) in models.into_iter().take(5).enumerate() {
        let prefix = if index == app.model_cursor && app.focus == Focus::Models {
            "> "
        } else {
            "  "
        };
        model_lines.push(Line::from(format!(
            "{prefix}{} ({})",
            model.label, model.id
        )));
    }
    if let Some(model_id) = app.current_model_id() {
        model_lines.push(Line::from(format!("Current: {model_id}")));
    }
    frame.render_widget(
        Paragraph::new(model_lines)
            .block(Block::default().title("Models").borders(Borders::ALL))
            .wrap(Wrap { trim: true }),
        right[0],
    );

    let message_lines = if app.messages.is_empty() {
        vec![Line::from("No messages yet.")]
    } else {
        app.messages
            .iter()
            .flat_map(|message| {
                let role = match message.role {
                    MessageRole::Assistant => "Assistant",
                    MessageRole::System => "System",
                    MessageRole::User => "You",
                };
                vec![
                    Line::from(Span::styled(
                        role,
                        Style::default().add_modifier(Modifier::BOLD),
                    )),
                    Line::from(message.content.clone()),
                    Line::from(""),
                ]
            })
            .collect::<Vec<_>>()
    };
    frame.render_widget(
        Paragraph::new(message_lines)
            .block(Block::default().title("Chat").borders(Borders::ALL))
            .wrap(Wrap { trim: false }),
        right[1],
    );

    frame.render_widget(&app.composer, right[2]);
    frame.render_widget(
        Paragraph::new(app.status.clone()).style(Style::default().fg(Color::DarkGray)),
        right[3],
    );
}

async fn send_message(
    client: GitHubCopilotClient,
    store: &ThreadStore,
    app: &mut App,
    event_tx: mpsc::UnboundedSender<AppEvent>,
) -> Result<()> {
    let session = app
        .session
        .clone()
        .ok_or_else(|| anyhow::anyhow!("auth_required"))?;
    let model_id = app
        .config
        .current_model_id
        .clone()
        .ok_or_else(|| anyhow::anyhow!("model_required"))?;
    let prompt = app.composer.lines().join("\n");
    if prompt.trim().is_empty() {
        return Ok(());
    }
    app.composer = TextArea::default();
    app.composer
        .set_block(Block::default().title("Composer").borders(Borders::ALL));
    let thread_id = app
        .current_thread_id
        .clone()
        .unwrap_or_else(|| format!("thread-{}", Uuid::new_v4()));
    app.current_thread_id = Some(thread_id.clone());
    app.config.current_thread_id = Some(thread_id.clone());

    let user_message = ChatMessage {
        content: prompt,
        id: format!("msg-{}", Uuid::new_v4()),
        role: MessageRole::User,
    };
    let mut thread = store
        .append_to_thread(&thread_id, &model_id, user_message)
        .await?;
    let request_messages = thread.messages.clone();
    let assistant_message = ChatMessage {
        content: String::new(),
        id: format!("msg-{}", Uuid::new_v4()),
        role: MessageRole::Assistant,
    };
    thread.messages.push(assistant_message.clone());
    store.save_thread(&thread).await?;
    app.messages = thread.messages.clone();
    app.config.current_model_id = Some(model_id.clone());
    store.save_config(&app.config).await?;
    app.status = "Streaming...".into();

    let tx = event_tx.clone();
    app.stream_task = Some(tokio::spawn(async move {
        let result = client
            .stream_chat(
                &session.token,
                session.organization.as_deref(),
                &model_id,
                &request_messages,
                |event| {
                    tx.send(AppEvent::ChatStream(event))
                        .map_err(|_| anyhow::anyhow!("ui_channel_closed"))?;
                    Ok(())
                },
            )
            .await;

        match result {
            Ok(()) => {
                let _ = event_tx.send(AppEvent::ChatDone("Reply complete".into()));
            }
            Err(error_value) => {
                let _ = event_tx.send(AppEvent::ChatError(error_value.to_string()));
            }
        }
    }));

    app.threads = store.list_threads().await?;
    Ok(())
}

async fn start_login(
    client: GitHubCopilotClient,
    app: &mut App,
    event_tx: mpsc::UnboundedSender<AppEvent>,
) -> Result<()> {
    let device = client.start_device_authorization(None).await?;
    let _ = open::that(&device.verification_uri);
    app.auth_prompt = Some(device.clone());
    app.status = "Waiting for GitHub approval".into();

    tokio::spawn(async move {
        let mut interval = device.interval_seconds;
        loop {
            tokio::time::sleep(Duration::from_secs(interval)).await;
            match client
                .poll_device_authorization(&device.device_code, device.organization.as_deref())
                .await
            {
                Ok(DeviceAuthorizationStatus::Pending { interval_seconds }) => {
                    interval = interval_seconds;
                }
                Ok(DeviceAuthorizationStatus::Complete(session)) => {
                    let _ = event_tx.send(AppEvent::AuthComplete(session));
                    break;
                }
                Err(error_value) => {
                    let _ = event_tx.send(AppEvent::AuthError(error_value.to_string()));
                    break;
                }
            }
        }
    });
    Ok(())
}

fn centered_rect(area: Rect, width_percent: u16, height_percent: u16) -> Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - height_percent) / 2),
            Constraint::Percentage(height_percent),
            Constraint::Percentage((100 - height_percent) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - width_percent) / 2),
            Constraint::Percentage(width_percent),
            Constraint::Percentage((100 - width_percent) / 2),
        ])
        .split(vertical[1])[1]
}

fn key_event_to_input(value: KeyEvent) -> Input {
    let key = match value.code {
        KeyCode::Backspace => Key::Backspace,
        KeyCode::Delete => Key::Delete,
        KeyCode::Down => Key::Down,
        KeyCode::End => Key::End,
        KeyCode::Enter => Key::Enter,
        KeyCode::Esc => Key::Esc,
        KeyCode::F(index) => Key::F(index),
        KeyCode::Home => Key::Home,
        KeyCode::Left => Key::Left,
        KeyCode::PageDown => Key::PageDown,
        KeyCode::PageUp => Key::PageUp,
        KeyCode::Right => Key::Right,
        KeyCode::Tab => Key::Tab,
        KeyCode::Up => Key::Up,
        KeyCode::Char(value) => Key::Char(value),
        _ => Key::Null,
    };

    Input {
        alt: value.modifiers.contains(KeyModifiers::ALT),
        ctrl: value.modifiers.contains(KeyModifiers::CONTROL),
        key,
        shift: value.modifiers.contains(KeyModifiers::SHIFT),
    }
}
