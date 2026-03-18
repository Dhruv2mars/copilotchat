use std::{fs, path::PathBuf};

use anyhow::Result;
use serde::{Deserialize, Serialize};

const SESSION_KEY: &str = "copilot_session_v3";
const REFRESH_SKEW_SECONDS: u64 = 60;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredSession {
    pub account_label: String,
    pub expires_at: Option<String>,
    pub organization: Option<String>,
    pub refresh_token: Option<String>,
    pub refresh_token_expires_at: Option<String>,
    pub token: String,
    pub token_hint: String,
}

pub trait SecretStore {
    fn delete(&self, key: &str) -> Result<()>;
    fn get(&self, key: &str) -> Result<Option<String>>;
    fn set(&self, key: &str, value: &str) -> Result<()>;
}

pub struct SessionStore<S> {
    store: S,
}

impl<S> SessionStore<S>
where
    S: SecretStore,
{
    pub fn new(store: S) -> Self {
        Self { store }
    }

    pub fn clear(&self) -> Result<()> {
        self.store.delete(SESSION_KEY)
    }

    pub fn load(&self) -> Result<Option<StoredSession>> {
        let raw = self.store.get(SESSION_KEY)?;
        raw.map(|value| serde_json::from_str(&value).map_err(Into::into))
            .transpose()
    }

    pub fn save(&self, session: &StoredSession) -> Result<()> {
        self.store
            .set(SESSION_KEY, &serde_json::to_string(session)?)
    }
}

pub struct FileSecretStore {
    path: PathBuf,
}

impl FileSecretStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl SecretStore for FileSecretStore {
    fn delete(&self, _key: &str) -> Result<()> {
        if self.path.exists() {
            fs::remove_file(&self.path)?;
        }
        Ok(())
    }

    fn get(&self, _key: &str) -> Result<Option<String>> {
        if !self.path.exists() {
            return Ok(None);
        }

        Ok(Some(fs::read_to_string(&self.path)?))
    }

    fn set(&self, _key: &str, value: &str) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(&self.path, value)?;
        restrict_session_file(&self.path)?;
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_session_file(path: &PathBuf) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o600);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_session_file(_path: &PathBuf) -> Result<()> {
    Ok(())
}

pub fn session_needs_refresh(session: &StoredSession) -> bool {
    let Some(expires_at) = session.expires_at.as_deref() else {
        return false;
    };
    let Ok(expires_at) = expires_at.parse::<u64>() else {
        return false;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time after epoch")
        .as_secs();
    expires_at <= now + REFRESH_SKEW_SECONDS
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::HashMap, fs};

    use tempfile::tempdir;

    use super::{FileSecretStore, SecretStore, SessionStore, StoredSession};

    struct MemorySecretStore {
        values: RefCell<HashMap<String, String>>,
    }

    impl SecretStore for MemorySecretStore {
        fn delete(&self, key: &str) -> anyhow::Result<()> {
            self.values.borrow_mut().remove(key);
            Ok(())
        }

        fn get(&self, key: &str) -> anyhow::Result<Option<String>> {
            Ok(self.values.borrow().get(key).cloned())
        }

        fn set(&self, key: &str, value: &str) -> anyhow::Result<()> {
            self.values
                .borrow_mut()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }
    }

    #[test]
    fn saves_loads_and_clears_session_json() {
        let store = SessionStore::new(MemorySecretStore {
            values: RefCell::new(HashMap::new()),
        });
        let session = StoredSession {
            account_label: "dhruv2mars".into(),
            expires_at: Some("2026-03-18T12:00:00Z".into()),
            organization: Some("acme".into()),
            refresh_token: Some("refresh-token".into()),
            refresh_token_expires_at: Some("2026-03-19T12:00:00Z".into()),
            token: "access-token".into(),
            token_hint: "acce...oken".into(),
        };

        store.save(&session).expect("save");
        assert_eq!(store.load().expect("load"), Some(session));

        store.clear().expect("clear");
        assert_eq!(store.load().expect("load after clear"), None);
    }

    #[test]
    fn file_secret_store_persists_and_clears_without_system_prompt_path() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.json");
        let store = FileSecretStore::new(path.clone());

        store.set("ignored", "secret").expect("set");
        assert_eq!(store.get("ignored").expect("get"), Some("secret".into()));

        store.delete("ignored").expect("delete");
        assert_eq!(store.get("ignored").expect("get after delete"), None);
    }

    #[cfg(unix)]
    #[test]
    fn file_secret_store_locks_session_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.json");
        let store = FileSecretStore::new(path.clone());

        store.set("ignored", "secret").expect("set");

        let mode = fs::metadata(path).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
