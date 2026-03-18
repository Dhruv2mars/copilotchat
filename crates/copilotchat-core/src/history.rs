use std::path::PathBuf;

use anyhow::{Context, Result};
use tokio::fs;

use crate::{
    config::AppPaths,
    types::{AppConfig, ChatMessage, ThreadRecord, ThreadSummary},
};

pub struct ThreadStore {
    paths: AppPaths,
}

impl ThreadStore {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    pub async fn append_to_thread(
        &self,
        thread_id: &str,
        model_id: &str,
        message: ChatMessage,
    ) -> Result<ThreadRecord> {
        self.ensure_layout().await?;
        let mut thread = match self.thread(thread_id).await {
            Ok(thread) => thread,
            Err(_) => ThreadRecord {
                created_at: now_timestamp(),
                id: thread_id.to_string(),
                messages: Vec::new(),
                model_id: model_id.to_string(),
                title: title_from_message(&message.content),
                updated_at: now_timestamp(),
            },
        };

        if thread.title.trim().is_empty() {
            thread.title = title_from_message(&message.content);
        }
        thread.model_id = model_id.to_string();
        thread.updated_at = now_timestamp();
        thread.messages.push(message);
        self.save_thread(&thread).await?;
        Ok(thread)
    }

    pub async fn load_config(&self) -> Result<AppConfig> {
        self.ensure_layout().await?;
        if !self.paths.config_path.exists() {
            return Ok(AppConfig::default());
        }

        let raw = fs::read_to_string(&self.paths.config_path)
            .await
            .with_context(|| format!("read {}", self.paths.config_path.display()))?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub async fn save_config(&self, config: &AppConfig) -> Result<()> {
        self.ensure_layout().await?;
        atomic_write_json(&self.paths.config_path, config).await
    }

    pub async fn save_thread(&self, thread: &ThreadRecord) -> Result<()> {
        self.ensure_layout().await?;
        atomic_write_json(&self.thread_path(&thread.id), thread).await
    }

    pub async fn thread(&self, thread_id: &str) -> Result<ThreadRecord> {
        let raw = fs::read_to_string(self.thread_path(thread_id)).await?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub async fn delete_thread(&self, thread_id: &str) -> Result<()> {
        let path = self.thread_path(thread_id);
        if path.exists() {
            fs::remove_file(path).await?;
        }
        Ok(())
    }

    pub async fn list_threads(&self) -> Result<Vec<ThreadSummary>> {
        self.ensure_layout().await?;
        let mut entries = fs::read_dir(&self.paths.threads_dir).await?;
        let mut summaries = Vec::new();

        while let Some(entry) = entries.next_entry().await? {
            let raw = fs::read_to_string(entry.path()).await?;
            let thread: ThreadRecord = serde_json::from_str(&raw)?;
            summaries.push(ThreadSummary {
                id: thread.id,
                model_id: thread.model_id,
                title: thread.title,
                updated_at: thread.updated_at,
            });
        }

        summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(summaries)
    }

    async fn ensure_layout(&self) -> Result<()> {
        fs::create_dir_all(&self.paths.root).await?;
        fs::create_dir_all(&self.paths.logs_dir).await?;
        fs::create_dir_all(&self.paths.threads_dir).await?;
        Ok(())
    }

    fn thread_path(&self, thread_id: &str) -> PathBuf {
        self.paths.threads_dir.join(format!("{thread_id}.json"))
    }
}

async fn atomic_write_json<T>(path: &PathBuf, value: &T) -> Result<()>
where
    T: serde::Serialize,
{
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, serde_json::to_vec_pretty(value)?).await?;
    fs::rename(temp_path, path).await?;
    Ok(())
}

fn now_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("current time after epoch")
        .as_secs()
        .to_string()
}

fn title_from_message(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return "New chat".to_string();
    }

    let mut title = trimmed.chars().take(48).collect::<String>();
    if trimmed.chars().count() > 48 {
        title.push_str("...");
    }
    title
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::{
        config::AppPaths,
        types::{AppConfig, ChatMessage, MessageRole},
    };

    use super::ThreadStore;

    #[tokio::test]
    async fn persists_threads_and_config_under_app_root() {
        let temp = tempdir().expect("tempdir");
        let store = ThreadStore::new(AppPaths::from_root(temp.path().join(".copilotchat")));

        let thread = store
            .append_to_thread(
                "thread-1",
                "gpt-5.2",
                ChatMessage {
                    content: "indian capital city?".into(),
                    id: "msg-1".into(),
                    role: MessageRole::User,
                },
            )
            .await
            .expect("append user");

        assert_eq!(thread.id, "thread-1");
        assert_eq!(thread.model_id, "gpt-5.2");
        assert_eq!(thread.messages.len(), 1);

        let saved = store.thread("thread-1").await.expect("load thread");
        assert_eq!(saved.messages[0].content, "indian capital city?");

        store
            .save_config(&AppConfig {
                current_model_id: Some("gpt-5.2".into()),
                current_thread_id: Some("thread-1".into()),
            })
            .await
            .expect("save config");

        assert_eq!(
            store.load_config().await.expect("load config"),
            AppConfig {
                current_model_id: Some("gpt-5.2".into()),
                current_thread_id: Some("thread-1".into())
            }
        );
    }
}
