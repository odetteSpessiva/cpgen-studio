#[path = "../lsp.rs"]
mod lsp;

use std::collections::HashMap;
use std::io::{self, BufRead};
use tauri::Listener;
use tauri::Manager;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() {
    let lsp_state = lsp::LspState(Mutex::new(HashMap::new()));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(lsp_state)
        .build(tauri::generate_context!())
        .expect("failed to build headless tauri context");

    let handle = app.handle();
    handle.listen_any("lsp-message", |event| {
        println!("\n<<< Received LSP Output:\n{}", event.payload());
    });
    let state = app.state::<lsp::LspState>();
    println!("--- LSP Terminal Test ---");
    let stdin = io::stdin();
    for line in stdin.lock().lines().map_while(Result::ok) {
        let parts: Vec<&str> = line.trim().splitn(2, ' ').collect();
        match parts.as_slice() {
            ["start"] => {
                if let Err(e) = lsp::lsp_start(handle.clone(), state.clone(), "cpp".into()).await {
                    eprintln!("Error starting LSP: {e}");
                }
            }
            ["send", json] => {
                if let Err(e) = lsp::lsp_send(state.clone(), "cpp".into(), json.to_string()).await {
                    eprintln!("Error sending payload: {e}");
                }
            }
            ["exit"] => {
                println!("Cleaning up LSP...");
                if let Err(e) = lsp::lsp_kill(state.clone(), "cpp".into()).await {
                    eprintln!("Error killing LSP: {e}");
                }
                break;
            }
            _ => println!("Format: start | send <json> | exit"),
        }
    }
}
