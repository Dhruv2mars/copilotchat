use anyhow::Result;
use clap::Parser;
use copilotchat_cli::{Cli, run};

#[tokio::main]
async fn main() -> Result<()> {
    run(Cli::parse()).await
}
