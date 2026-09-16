use serde::Serialize;
use std::{collections::HashMap, process::Stdio, sync::Arc};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::Mutex,
};

#[derive(Serialize, Clone)]
struct LspMessagePayload {
    language: String,
    payload: String,
}

pub struct Session {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}
pub struct LspState(pub Mutex<HashMap<String, Session>>);
pub struct GppTripleState(pub Mutex<Option<String>>);

async fn get_gpp_target_triple(gpp_path: &str) -> Result<Option<String>, String> {
    let output = Command::new(gpp_path)
        .arg("-dumpmachine")
        .output()
        .await
        .map_err(|e| format!("Failed to run g++ -dumpmachine: {e}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let triple = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if triple.is_empty() {
        None
    } else {
        Some(triple)
    })
}

async fn read_message<R: AsyncBufReadExt + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<String>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line).await?;
        if bytes_read == 0 {
            return Ok(None);
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = value.trim().parse::<usize>().ok();
        }
    }
    let content_length = content_length
        .ok_or_else(|| std::io::Error::other("Missing header Content-Length in payload"))?;
    let mut buf = vec![0u8; content_length];
    reader.read_exact(&mut buf).await?;
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
    state: tauri::State<'_, LspState>,
    gpp_triple_state: tauri::State<'_, GppTripleState>,
    language: String,
) -> Result<Option<String>, String> {
    let mut state_map = state.0.lock().await;
    if state_map.contains_key(&language) {
        return Ok(None);
    }
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let (default_bin, setting_key) = match language.as_str() {
        "cpp" => ("clangd", "clangdPath"),
        "python" => ("python", "pythonPath"),
        other => return Err(format!("Lsp server is not yet supported for '{other}'!")),
    };

    let config_bin = store
        .get(setting_key)
        .and_then(|f| f.as_str().map(String::from))
        .unwrap_or_default();

    let target_triple = if language == "cpp" {
        let mut cached = gpp_triple_state.0.lock().await;
        if cached.is_none() {
            let gpp_config = store
                .get("gppPath")
                .and_then(|f| f.as_str().map(String::from))
                .unwrap_or_default();
            let gpp_path = if gpp_config.trim().is_empty() {
                "g++".to_string()
            } else {
                gpp_config
            };
            *cached = get_gpp_target_triple(&gpp_path).await?;
        }
        cached.clone()
    } else {
        None
    };

    let program = if config_bin.trim().is_empty() {
        default_bin.to_string()
    } else {
        config_bin
    };

    let args = if language == "python" {
        vec!["-m", "pylsp"]
    } else {
        vec!["--fallback-style=Google"]
    };

    let mut child = Command::new(&program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("LSP failed to start: {e}"))?;

    let stdin = child.stdin.take().ok_or("Failed to open LSP stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to open LSP stdout")?;

    let app_handle = app.clone();
    let lang = language.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        while let Ok(Some(payload)) = read_message(&mut reader).await {
            let _ = app_handle.emit(
                "lsp-message",
                LspMessagePayload {
                    language: lang.clone(),
                    payload,
                },
            );
        }
        let _ = app_handle.emit("lsp-exit", lang);
    });

    state_map.insert(
        language,
        Session {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
        },
    );

    Ok(target_triple)
}

#[tauri::command]
pub async fn lsp_send(
    state: tauri::State<'_, LspState>,
    language: String,
    payload: String,
) -> Result<(), String> {
    let stdin_arc = {
        let state_map = state.0.lock().await;
        state_map
            .get(&language)
            .map(|v| Arc::clone(&v.stdin))
            .ok_or("Unable to load session!")?
    };
    let framed = format!("Content-Length: {}\r\n\r\n{}", payload.len(), payload);
    let mut stdin = stdin_arc.lock().await;
    stdin
        .write_all(framed.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn lsp_kill(state: tauri::State<'_, LspState>, language: String) -> Result<(), String> {
    let mut state_map = state.0.lock().await;
    if let Some(mut session) = state_map.remove(&language) {
        session
            .child
            .kill()
            .await
            .map_err(|e| format!("Unable to kill LSP process: {e}"))?;
    }
    Ok(())
}
