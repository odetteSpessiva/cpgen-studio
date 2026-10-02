use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{ipc::Channel, AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const ANTHROPIC_MAX_TOKENS: u32 = 4096;

#[derive(Deserialize, Serialize)]
pub(crate) struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatAttachment {
    path: String,
    name: String,
    mime_type: String,
    data_base64: String,
    text: Option<String>,
}

fn attachment_part(attachment: &ChatAttachment) -> serde_json::Value {
    if attachment.mime_type == "application/pdf" {
        serde_json::json!({
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": attachment.mime_type,
                "data": attachment.data_base64,
            }
        })
    } else {
        serde_json::json!({
            "type": "text",
            "text": attachment.text.as_deref().unwrap_or(
                "The attached file has no text representation.",
            ),
        })
    }
}

#[tauri::command]
pub(crate) async fn send_message(
    provider: String,
    base_url: String,
    model: String,
    messages: Vec<ChatMessage>,
    attachment: Option<ChatAttachment>,
    on_delta: Channel<String>,
) -> Result<String, String> {
    let api_key = crate::ai::get_key(provider.clone())
        .await?
        .ok_or("No API key saved for this provider")?;
    let client = reqwest::Client::builder()
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build client: {e}"))?;
    let base_url = base_url.trim_end_matches('/');
    let has_pdf = attachment
        .as_ref()
        .is_some_and(|file| file.mime_type == "application/pdf");
    let attachment_message_index = attachment
        .as_ref()
        .and_then(|_| messages.iter().position(|message| message.role == "user"));

    let request = match provider.as_str() {
        "openai" if has_pdf => {
            let input = messages
                .iter()
                .enumerate()
                .map(|(index, message)| {
                    let content = if Some(index) == attachment_message_index {
                        serde_json::json!([
                            { "type": "input_text", "text": message.content },
                            {
                                "type": "input_file",
                                "filename": attachment.as_ref().unwrap().name,
                                "file_data": format!(
                                    "data:{};base64,{}",
                                    attachment.as_ref().unwrap().mime_type,
                                    attachment.as_ref().unwrap().data_base64
                                ),
                            }
                        ])
                    } else {
                        serde_json::json!(message.content)
                    };
                    serde_json::json!({
                        "role": message.role,
                        "content": content,
                    })
                })
                .collect::<Vec<_>>();
            client
                .post(format!("{base_url}/responses"))
                .bearer_auth(&api_key)
                .json(&serde_json::json!({
                    "model": model,
                    "input": input,
                    "stream": true,
                }))
        }
        "openai" => client
            .post(format!("{base_url}/chat/completions"))
            .bearer_auth(&api_key)
            .json(&serde_json::json!({
                "model": model,
                "messages": messages,
                "stream": true,
            })),
        "anthropic" => {
            let api_messages = messages
                .iter()
                .filter(|message| message.role != "system")
                .enumerate()
                .map(|(index, message)| {
                    let content = if Some(index) == attachment_message_index {
                        serde_json::json!([
                            { "type": "text", "text": message.content },
                            attachment_part(attachment.as_ref().unwrap()),
                        ])
                    } else {
                        serde_json::json!(message.content)
                    };
                    serde_json::json!({ "role": message.role, "content": content })
                })
                .collect::<Vec<_>>();
            client
                .post(format!("{base_url}/messages"))
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&serde_json::json!({
                    "model": model,
                    "max_tokens": ANTHROPIC_MAX_TOKENS,
                    "system": messages.iter()
                        .filter(|message| message.role == "system")
                        .map(|message| message.content.as_str())
                        .collect::<Vec<_>>()
                        .join("\n\n"),
                    "messages": api_messages,
                    "stream": true,
                }))
        }
        "google" => {
            let contents = messages
                .iter()
                .filter(|message| message.role != "system")
                .enumerate()
                .map(|(_, message)| {
                    let mut parts = vec![serde_json::json!({ "text": message.content })];
                    if message.role == "user"
                        && attachment_message_index.is_some()
                        && message.content.starts_with("Attached problem")
                    {
                        if let Some(file) = &attachment {
                            parts.push(serde_json::json!({
                                "inlineData": {
                                    "mimeType": file.mime_type,
                                    "data": file.data_base64,
                                }
                            }));
                        }
                    }
                    serde_json::json!({
                        "role": if message.role == "assistant" { "model" } else { "user" },
                        "parts": parts,
                    })
                })
                .collect::<Vec<_>>();
            client
                .post(format!(
                    "{base_url}/models/{model}:streamGenerateContent?alt=sse"
                ))
                .header("x-goog-api-key", &api_key)
                .json(&serde_json::json!({
                    "systemInstruction": {
                        "parts": messages.iter()
                            .filter(|message| message.role == "system")
                            .map(|message| serde_json::json!({ "text": message.content }))
                            .collect::<Vec<_>>()
                    },
                    "contents": contents
                }))
        }
        _ => return Err(format!("Unknown provider: {provider}")),
    };

    let response = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {e}"))?;
        return Err(format!("Provider returned {status}: {body}"));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();
    let mut reply = String::new();
    while let Some(chunk) = stream.next().await {
        buffer.extend_from_slice(&chunk.map_err(|e| format!("Stream failed: {e}"))?);
        while let Some(newline) = buffer.iter().position(|&byte| byte == b'\n') {
            let line = String::from_utf8_lossy(&buffer[..newline]).into_owned();
            buffer.drain(..=newline);
            let Some(data) = line.trim().strip_prefix("data:") else {
                continue;
            };
            let Ok(event) = serde_json::from_str::<serde_json::Value>(data.trim()) else {
                continue;
            };
            if let Some(message) = event["error"]["message"].as_str() {
                return Err(format!("Provider error: {message}"));
            }
            let delta = match provider.as_str() {
                "openai" if has_pdf => {
                    if event["type"].as_str() == Some("response.output_text.delta") {
                        event["delta"].as_str()
                    } else {
                        None
                    }
                }
                "openai" => event["choices"][0]["delta"]["content"].as_str(),
                "anthropic" => event["delta"]["text"].as_str(),
                _ => event["candidates"][0]["content"]["parts"][0]["text"].as_str(),
            };
            if let Some(text) = delta.filter(|text| !text.is_empty()) {
                on_delta
                    .send(text.to_string())
                    .map_err(|e| format!("Failed to send delta: {e}"))?;
                reply.push_str(text);
            }
        }
    }
    Ok(reply)
}

fn mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("pdf") => "application/pdf",
        Some(extension)
            if extension.eq_ignore_ascii_case("txt") || extension.eq_ignore_ascii_case("md") =>
        {
            "text/plain"
        }
        _ => "application/octet-stream",
    }
}

#[tauri::command(async)]
pub(crate) fn pick_chat_attachment(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<ChatAttachment>, String> {
    let Some(file_path) = app.dialog().file().set_parent(&window).blocking_pick_file() else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|error| format!("failed to resolve selected attachment: {error}"))?;
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment")
        .to_string();
    let text = if mime_type(&path).starts_with("text/") {
        Some(
            String::from_utf8(bytes.clone())
                .map_err(|error| format!("selected text attachment is not valid UTF-8: {error}"))?,
        )
    } else {
        None
    };

    Ok(Some(ChatAttachment {
        path: path.display().to_string(),
        name,
        mime_type: mime_type(&path).to_string(),
        data_base64: STANDARD.encode(bytes),
        text,
    }))
}
