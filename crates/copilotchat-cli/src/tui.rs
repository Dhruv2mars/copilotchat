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
    widgets::{Block, BorderType, Borders, Clear, Paragraph, Wrap},
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
    Threads,
    Chat,
    Composer,
    Models,
}

struct App {
    auth_prompt: Option<DeviceAuthorization>,
    chat_follow: bool,
    chat_max_scroll: u16,
    chat_scroll: u16,
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
        composer.set_block(panel_block("Composer", true));
        Self {
            auth_prompt: None,
            chat_follow: true,
            chat_max_scroll: 0,
            chat_scroll: 0,
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
        let mut models = self
            .models
            .iter()
            .filter(|model| {
                query.is_empty()
                    || model.id.to_lowercase().contains(&query)
                    || model.label.to_lowercase().contains(&query)
            })
            .collect::<Vec<_>>();
        models.sort_by(|left, right| {
            availability_rank(left)
                .cmp(&availability_rank(right))
                .then_with(|| left.label.cmp(&right.label))
        });
        models
    }

    fn has_session(&self) -> bool {
        self.session.is_some()
    }

    fn is_streaming(&self) -> bool {
        self.stream_task.is_some()
    }

    fn next_focus(&mut self) {
        self.focus = match self.focus {
            Focus::Threads => Focus::Chat,
            Focus::Chat => Focus::Composer,
            Focus::Composer => Focus::Models,
            Focus::Models => Focus::Threads,
        };
    }

    fn previous_focus(&mut self) {
        self.focus = match self.focus {
            Focus::Threads => Focus::Models,
            Focus::Chat => Focus::Threads,
            Focus::Composer => Focus::Chat,
            Focus::Models => Focus::Composer,
        };
    }

    fn set_current_thread(&mut self, thread: Option<&ThreadSummary>) {
        self.current_thread_id = thread.map(|value| value.id.clone());
        self.config.current_thread_id = self.current_thread_id.clone();
    }

    fn current_model_label(&self) -> String {
        self.models
            .iter()
            .find(|model| self.current_model_id() == Some(model.id.as_str()))
            .map(|model| model.label.clone())
            .unwrap_or_else(|| "No model".into())
    }

    fn current_thread_title(&self) -> String {
        self.threads
            .iter()
            .find(|thread| self.current_thread_id.as_deref() == Some(thread.id.as_str()))
            .map(|thread| thread.title.clone())
            .unwrap_or_else(|| "New chat".into())
    }

    fn focus_label(&self) -> &'static str {
        match self.focus {
            Focus::Threads => "Threads",
            Focus::Chat => "Chat",
            Focus::Composer => "Composer",
            Focus::Models => "Models",
        }
    }
}

pub async fn run_tui(client: GitHubCopilotClient) -> Result<()> {
    let store = thread_store().await?;
    let mut app = App::new(store.load_config().await?, store.list_threads().await?);
    if let Ok(session) = load_session(&client).await {
        app.session = Some(session.clone());
        app.models = client.list_models(&session.token).await?;
        app.config.current_model_id = Some(choose_model(&app.config, &app.models)?);
        app.status = format!("Connected: {}", session.account_label);
    }
    if let Some(thread_id) = app.config.current_thread_id.clone() {
        if let Ok(thread) = store.thread(&thread_id).await {
            app.current_thread_id = Some(thread_id);
            app.messages = thread.messages;
            if let Some(index) = app
                .threads
                .iter()
                .position(|thread| app.current_thread_id.as_deref() == Some(thread.id.as_str()))
            {
                app.thread_cursor = index;
            }
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
            app.chat_follow = true;
            app.status = message;
            persist_current_thread(store, app).await?;
        }
        AppEvent::ChatError(message) => {
            app.stream_task = None;
            app.chat_follow = true;
            app.status = message;
            persist_current_thread(store, app).await?;
        }
        AppEvent::ChatStream(stream_event) => match stream_event {
            StreamEvent::Delta(delta) => {
                if let Some(last_message) = app.messages.last_mut() {
                    last_message.content.push_str(&delta);
                }
                if app.chat_follow {
                    app.chat_scroll = app.chat_max_scroll;
                }
                persist_current_thread(store, app).await?;
            }
            StreamEvent::Done(usage) => {
                app.stream_task = None;
                app.chat_follow = true;
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

    if key_event.modifiers.contains(KeyModifiers::CONTROL) {
        match key_event.code {
            KeyCode::Char('n') => {
                create_new_thread(store, app).await?;
                return Ok(false);
            }
            KeyCode::Char('l') => {
                logout(app).await?;
                return Ok(false);
            }
            KeyCode::Char('j') => {
                app.focus = Focus::Threads;
                return Ok(false);
            }
            KeyCode::Char('k') => {
                app.focus = Focus::Models;
                return Ok(false);
            }
            KeyCode::Char('g') => {
                app.focus = Focus::Chat;
                return Ok(false);
            }
            KeyCode::Char('m') => {
                app.focus = Focus::Composer;
                return Ok(false);
            }
            _ => {}
        }
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
    if key_event.code == KeyCode::BackTab {
        app.previous_focus();
        return Ok(false);
    }

    match app.focus {
        Focus::Threads => handle_thread_key(key_event, store, app).await?,
        Focus::Chat => handle_chat_key(key_event, app),
        Focus::Composer => handle_composer_key(key_event, client, store, app, event_tx).await?,
        Focus::Models => handle_model_key(key_event, store, app).await?,
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
                if !is_available_model(model) {
                    app.status = format!("Unavailable in Copilot: {}", model.label);
                    return Ok(());
                }
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
            create_new_thread(store, app).await?;
        }
        KeyCode::Backspace | KeyCode::Delete | KeyCode::Char('d') => {
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

fn handle_chat_key(key_event: KeyEvent, app: &mut App) {
    match key_event.code {
        KeyCode::Up => {
            app.chat_follow = false;
            app.chat_scroll = app.chat_scroll.saturating_sub(1);
        }
        KeyCode::Down => {
            app.chat_follow = false;
            app.chat_scroll = (app.chat_scroll + 1).min(app.chat_max_scroll);
        }
        KeyCode::PageUp => {
            app.chat_follow = false;
            app.chat_scroll = app.chat_scroll.saturating_sub(6);
        }
        KeyCode::PageDown => {
            app.chat_follow = false;
            app.chat_scroll = (app.chat_scroll + 6).min(app.chat_max_scroll);
        }
        KeyCode::Home => {
            app.chat_follow = false;
            app.chat_scroll = 0;
        }
        KeyCode::End | KeyCode::Esc => {
            app.chat_follow = true;
            app.chat_scroll = app.chat_max_scroll;
        }
        _ => {}
    }
}

async fn create_new_thread(store: &ThreadStore, app: &mut App) -> Result<()> {
    app.current_thread_id = Some(format!("thread-{}", Uuid::new_v4()));
    app.config.current_thread_id = app.current_thread_id.clone();
    app.messages.clear();
    app.chat_follow = true;
    app.chat_scroll = 0;
    store.save_config(&app.config).await?;
    app.status = "New chat".into();
    Ok(())
}

async fn logout(app: &mut App) -> Result<()> {
    session_store()?.clear()?;
    if let Some(task) = app.stream_task.take() {
        task.abort();
    }
    app.session = None;
    app.auth_prompt = None;
    app.models.clear();
    app.model_query.clear();
    app.model_cursor = 0;
    app.status = "Logged out".into();
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

    let created_at = store
        .thread(&thread_id)
        .await
        .map(|thread| thread.created_at)
        .unwrap_or_else(|_| current_timestamp());

    let thread = copilotchat_core::types::ThreadRecord {
        created_at,
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

fn render(area: Rect, frame: &mut ratatui::Frame<'_>, app: &mut App) {
    if !app.has_session() {
        let block = panel_block("Connect GitHub Copilot", true);
        let content = if let Some(auth_prompt) = &app.auth_prompt {
            vec![
                Line::from("Approve GitHub Copilot in your browser."),
                Line::from(""),
                Line::from(Span::raw(format!("URL  {0}", auth_prompt.verification_uri))),
                Line::from(Span::styled(
                    format!("CODE {0}", auth_prompt.user_code),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                )),
                Line::from(""),
                Line::from("Waiting for approval..."),
                Line::from("Press q to quit."),
            ]
        } else {
            vec![
                Line::from("Press Enter to connect GitHub Copilot."),
                Line::from("Device auth opens in your browser."),
                Line::from(""),
                Line::from("Your Copilot token stays local."),
            ]
        };
        let paragraph = Paragraph::new(content)
            .block(block)
            .wrap(Wrap { trim: true });
        frame.render_widget(Clear, area);
        frame.render_widget(paragraph, centered_rect(area, 70, 35));
        return;
    }

    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(12),
            Constraint::Length(2),
        ])
        .split(area);
    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Length(34), Constraint::Min(48)])
        .split(outer[1]);
    let sidebar = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(11), Constraint::Min(10)])
        .split(body[0]);
    let content = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(12), Constraint::Length(6)])
        .split(body[1]);

    let header = Line::from(vec![
        Span::styled(
            " copilotchat ",
            Style::default()
                .fg(Color::Black)
                .bg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(format!(
            "  {}  |  {}  |  focus {}",
            app.current_model_label(),
            app.current_thread_title(),
            app.focus_label()
        )),
    ]);
    frame.render_widget(Paragraph::new(header), outer[0]);

    let model_lines = model_panel_lines(app);
    frame.render_widget(
        Paragraph::new(model_lines)
            .block(panel_block("Models", app.focus == Focus::Models))
            .wrap(Wrap { trim: false }),
        sidebar[0],
    );

    let thread_lines = thread_panel_lines(app);
    frame.render_widget(
        Paragraph::new(thread_lines)
            .block(panel_block("Threads", app.focus == Focus::Threads))
            .wrap(Wrap { trim: false }),
        sidebar[1],
    );

    let message_lines = message_panel_lines(app);
    let mut chat = Paragraph::new(message_lines.clone())
        .block(panel_block("Chat", app.focus == Focus::Chat))
        .wrap(Wrap { trim: false });
    app.chat_max_scroll = max_chat_scroll(&message_lines, content[0]);
    if app.chat_follow {
        app.chat_scroll = app.chat_max_scroll;
    } else {
        app.chat_scroll = app.chat_scroll.min(app.chat_max_scroll);
    }
    chat = chat.scroll((app.chat_scroll, 0));
    frame.render_widget(chat, content[0]);

    app.composer
        .set_block(panel_block("Composer", app.focus == Focus::Composer));
    frame.render_widget(&app.composer, content[1]);

    let footer = vec![
        Line::from(Span::styled(
            app.status.clone(),
            Style::default().fg(Color::Gray),
        )),
        Line::from(
            "Tab focus  Ctrl+N new  Ctrl+K models  Ctrl+J threads  Ctrl+M composer  Ctrl+L logout  Esc stop/clear",
        ),
    ];
    frame.render_widget(Paragraph::new(footer), outer[2]);
}

fn panel_block(title: &str, focused: bool) -> Block<'_> {
    let style = if focused {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    };
    Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(style)
}

fn model_panel_lines(app: &App) -> Vec<Line<'static>> {
    let query = if app.model_query.is_empty() {
        "Search models...".to_string()
    } else {
        app.model_query.clone()
    };
    let current = format!("Current: {}", app.current_model_label());
    let mut lines = vec![Line::from(query), Line::from(current), Line::from("")];
    for (index, model) in app.filtered_models().into_iter().take(6).enumerate() {
        let prefix = if index == app.model_cursor { ">" } else { " " };
        let state = if is_available_model(model) {
            ""
        } else {
            " [unavailable]"
        };
        lines.push(Line::from(format!("{prefix} {}{}", model.label, state)));
        lines.push(Line::from(format!("  {}", model.id)));
    }
    if lines.len() == 3 {
        lines.push(Line::from("No models match."));
    }
    lines
}

fn thread_panel_lines(app: &App) -> Vec<Line<'static>> {
    if app.threads.is_empty() {
        return vec![
            Line::from("No saved chats yet."),
            Line::from("Ctrl+N starts a new one."),
        ];
    }

    let mut lines = Vec::new();
    for (index, thread) in app.threads.iter().enumerate().take(10) {
        let prefix = if index == app.thread_cursor { ">" } else { " " };
        let current = if app.current_thread_id.as_deref() == Some(thread.id.as_str()) {
            " [open]"
        } else {
            ""
        };
        lines.push(Line::from(format!("{prefix} {}{}", thread.title, current)));
        lines.push(Line::from(format!("  {}", thread.model_id)));
    }
    lines
}

fn message_panel_lines(app: &App) -> Vec<Line<'static>> {
    if app.messages.is_empty() {
        return vec![
            Line::from(Span::styled(
                "Start chatting",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            )),
            Line::from(""),
            Line::from("Write a prompt in the composer below."),
            Line::from("Search models at left."),
            Line::from("Use Ctrl+N for a fresh chat."),
        ];
    }

    let assistant_label = app.current_model_label();
    app.messages
        .iter()
        .flat_map(|message| {
            let role = match message.role {
                MessageRole::Assistant => assistant_label.as_str(),
                MessageRole::System => "System",
                MessageRole::User => "You",
            };
            let role_style = match message.role {
                MessageRole::Assistant => Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
                MessageRole::System => Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
                MessageRole::User => Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            };
            let mut lines = vec![Line::from(Span::styled(role.to_string(), role_style))];
            if message.content.trim().is_empty() {
                lines.push(Line::from("..."));
            } else {
                lines.extend(
                    message
                        .content
                        .lines()
                        .map(|line| Line::from(line.to_string())),
                );
            }
            lines.push(Line::from(""));
            lines
        })
        .collect()
}

fn max_chat_scroll(lines: &[Line<'_>], area: Rect) -> u16 {
    if area.width == 0 || area.height == 0 {
        return 0;
    }
    let inner_width = area.width.saturating_sub(2).max(1) as usize;
    let inner_height = area.height.saturating_sub(2) as usize;
    let rendered_lines = lines
        .iter()
        .map(|line| line.width().max(1).div_ceil(inner_width))
        .sum::<usize>();
    rendered_lines.saturating_sub(inner_height) as u16
}

fn availability_rank(model: &ListedModel) -> u8 {
    if is_available_model(model) { 0 } else { 1 }
}

fn is_available_model(model: &ListedModel) -> bool {
    matches!(
        model.availability,
        copilotchat_core::types::ModelAvailability::Available
    )
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
    app.composer.set_block(panel_block("Composer", true));
    let thread_id = app
        .current_thread_id
        .clone()
        .unwrap_or_else(|| format!("thread-{}", Uuid::new_v4()));
    app.current_thread_id = Some(thread_id.clone());
    app.config.current_thread_id = Some(thread_id.clone());
    app.chat_follow = true;

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
    app.chat_scroll = app.chat_max_scroll;
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

#[cfg(test)]
mod tests {
    use copilotchat_core::types::ModelAvailability;

    use super::*;

    #[test]
    fn filtered_models_prioritize_available_results() {
        let mut app = App::new(AppConfig::default(), Vec::new());
        app.models = vec![
            ListedModel {
                availability: ModelAvailability::Unsupported,
                id: "gpt-5.4".into(),
                label: "GPT-5.4".into(),
            },
            ListedModel {
                availability: ModelAvailability::Available,
                id: "claude-sonnet-4.5".into(),
                label: "Claude Sonnet 4.5".into(),
            },
            ListedModel {
                availability: ModelAvailability::Available,
                id: "gpt-5.2".into(),
                label: "GPT-5.2".into(),
            },
        ];
        app.model_query = "gpt".into();

        let filtered = app.filtered_models();
        let result = filtered
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(result, vec!["gpt-5.2", "gpt-5.4"]);
    }

    #[test]
    fn max_chat_scroll_keeps_latest_lines_visible() {
        let lines = vec![
            Line::from("one"),
            Line::from("two"),
            Line::from("three"),
            Line::from("four"),
            Line::from("five"),
        ];

        assert_eq!(max_chat_scroll(&lines, Rect::new(0, 0, 20, 5)), 2);
        assert_eq!(max_chat_scroll(&lines, Rect::new(0, 0, 20, 8)), 0);
    }
}
