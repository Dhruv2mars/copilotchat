use std::path::PathBuf;

use anyhow::{Result, anyhow};

pub struct AppPaths {
    pub root: PathBuf,
    pub config_path: PathBuf,
    pub logs_dir: PathBuf,
    pub session_path: PathBuf,
    pub threads_dir: PathBuf,
}

impl AppPaths {
    pub fn detect() -> Result<Self> {
        let home = dirs::home_dir().ok_or_else(|| anyhow!("home_directory_unavailable"))?;
        Ok(Self::from_root(home.join(".copilotchat")))
    }

    pub fn from_root(root: PathBuf) -> Self {
        Self {
            config_path: root.join("config.json"),
            logs_dir: root.join("logs"),
            session_path: root.join("session.json"),
            threads_dir: root.join("threads"),
            root,
        }
    }
}
