use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{ipc::Channel, AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize, Serialize)]
pub(crate) struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatDelta {
    kind: &'static str,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatOptions {
    thinking: bool,
    effort: String,
    thinking_budget: i32,
    max_tokens: u32,
    json_mode: bool,
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
    } else if attachment.mime_type.starts_with("image/") {
        serde_json::json!({
            "type": "image",
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

fn is_google_openai_compatibility_url(base_url: &str) -> bool {
    base_url
        .to_ascii_lowercase()
        .contains("generativelanguage.googleapis.com/v1beta/openai")
}

fn openai_event_deltas(event: &serde_json::Value) -> Vec<(&'static str, String)> {
    let mut deltas = Vec::new();
    let choice = &event["choices"][0];
    let delta = &choice["delta"];
    let message = &choice["message"];

    fn collect_text(value: &serde_json::Value, output: &mut Vec<String>) {
        if let Some(text) = value.as_str().filter(|text| !text.is_empty()) {
            output.push(text.to_string());
        } else if let Some(values) = value.as_array() {
            for value in values {
                collect_text(value, output);
            }
        } else if let Some(object) = value.as_object() {
            for key in [
                "text",
                "content",
                "summary",
                "delta",
                "reasoning",
                "reasoning_content",
            ] {
                if let Some(value) = object.get(key) {
                    collect_text(value, output);
                }
            }
        }
    }

    let mut thinking = Vec::new();
    for value in [
        &delta["reasoning"],
        &delta["reasoning_content"],
        &delta["reasoning_details"],
        &delta["thinking"],
        &delta["thought"],
        &message["reasoning"],
        &message["reasoning_content"],
        &message["reasoning_details"],
        &message["thinking"],
        &message["thought"],
        &event["reasoning"],
        &event["reasoning_content"],
        &event["reasoning_details"],
    ] {
        collect_text(value, &mut thinking);
    }
    deltas.extend(thinking.into_iter().map(|text| ("thinking", text)));

    for value in [
        &delta["content"],
        &message["content"],
        &choice["text"],
        &event["output_text"],
    ] {
        if let Some(text) = value.as_str().filter(|text| !text.is_empty()) {
            deltas.push(("content", text.to_string()));
        } else if let Some(parts) = value.as_array() {
            for part in parts {
                if let Some(text) = part["text"]
                    .as_str()
                    .or(part["content"].as_str())
                    .filter(|text| !text.is_empty())
                {
                    deltas.push(("content", text.to_string()));
                }
            }
        }
    }
    deltas
}

#[tauri::command]
pub(crate) async fn send_message(
    provider: String,
    base_url: String,
    model: String,
    messages: Vec<ChatMessage>,
    attachment: Option<ChatAttachment>,
    options: ChatOptions,
    on_delta: Channel<ChatDelta>,
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
    let has_image = attachment
        .as_ref()
        .is_some_and(|file| file.mime_type.starts_with("image/"));
    let has_rich_attachment = has_pdf || has_image;
    let google_openai_compatibility = is_google_openai_compatibility_url(base_url);
    if google_openai_compatibility && has_pdf {
        return Err(
            "Google's OpenAI-compatible endpoint does not support PDF attachments; use the native Google provider for PDF input"
                .to_string(),
        );
    }
    // Text attachments are already inlined in the message by the frontend.
    let attachment_message_index = attachment
        .as_ref()
        .filter(|file| file.text.is_none())
        .and_then(|_| messages.iter().position(|message| message.role == "user"));

    let request = match provider.as_str() {
        "openai" if has_rich_attachment && !google_openai_compatibility => {
            let input = messages
                .iter()
                .enumerate()
                .map(|(index, message)| {
                    let content = if Some(index) == attachment_message_index {
                        serde_json::json!([
                            { "type": "input_text", "text": message.content },
                            if has_pdf {
                                serde_json::json!({
                                "type": "input_file",
                                "filename": attachment.as_ref().unwrap().name,
                                "file_data": format!(
                                    "data:{};base64,{}",
                                    attachment.as_ref().unwrap().mime_type,
                                    attachment.as_ref().unwrap().data_base64
                                ),
                                })
                            } else {
                                serde_json::json!({
                                    "type": "input_image",
                                    "image_url": format!(
                                        "data:{};base64,{}",
                                        attachment.as_ref().unwrap().mime_type,
                                        attachment.as_ref().unwrap().data_base64
                                    ),
                                })
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
            let mut body = serde_json::json!({
                "model": model,
                "input": input,
                "stream": true,
            });
            if options.thinking {
                body["reasoning"] = serde_json::json!({
                    "effort": options.effort,
                    "summary": "auto",
                });
            }
            if options.json_mode {
                body["text"] = serde_json::json!({ "format": { "type": "json_object" } });
            }
            client
                .post(format!("{base_url}/responses"))
                .bearer_auth(&api_key)
                .json(&body)
        }
        "openai" => {
            let mut body = serde_json::json!({
                "model": model,
                "messages": if has_image {
                    serde_json::json!(messages
                        .iter()
                        .enumerate()
                        .map(|(index, message)| {
                            if Some(index) == attachment_message_index {
                                serde_json::json!({
                                    "role": message.role,
                                    "content": [
                                        { "type": "text", "text": message.content },
                                        {
                                            "type": "image_url",
                                            "image_url": {
                                                "url": format!(
                                                    "data:{};base64,{}",
                                                    attachment.as_ref().unwrap().mime_type,
                                                    attachment.as_ref().unwrap().data_base64
                                                )
                                            }
                                        }
                                    ]
                                })
                            } else {
                                serde_json::json!({
                                    "role": message.role,
                                    "content": message.content
                                })
                            }
                        })
                        .collect::<Vec<_>>())
                } else {
                    serde_json::json!(messages)
                },
                "stream": true,
            });
            if options.thinking && base_url.contains("openrouter.ai") {
                body["reasoning"] = if options.thinking_budget > 0 {
                    serde_json::json!({ "max_tokens": options.thinking_budget })
                } else {
                    serde_json::json!({ "effort": options.effort })
                };
            } else if options.thinking && google_openai_compatibility {
                body["extra_body"] = serde_json::json!({
                    "google": {
                        "thinking_config": {
                            "thinking_level": options.effort,
                            "include_thoughts": true,
                        }
                    }
                });
            } else if options.thinking {
                body["reasoning_effort"] = serde_json::json!(options.effort);
            }
            if options.json_mode {
                body["response_format"] = serde_json::json!({ "type": "json_object" });
            }
            client
                .post(format!("{base_url}/chat/completions"))
                .bearer_auth(&api_key)
                .json(&body)
        }
        "anthropic" => {
            let api_messages = messages
                .iter()
                .enumerate()
                .filter(|(_, message)| message.role != "system")
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
            let mut body = serde_json::json!({
                "model": model,
                "max_tokens": options.max_tokens,
                "system": messages.iter()
                    .filter(|message| message.role == "system")
                    .map(|message| message.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n"),
                "messages": api_messages,
                "stream": true,
            });
            if options.thinking {
                if options.thinking_budget < 1024
                    || options.thinking_budget as u32 >= options.max_tokens
                {
                    return Err(format!(
                        "Anthropic thinking budget must be at least 1024 and below max tokens ({})",
                        options.max_tokens
                    ));
                }
                body["thinking"] = serde_json::json!({
                    "type": "enabled",
                    "budget_tokens": options.thinking_budget,
                });
            }
            client
                .post(format!("{base_url}/messages"))
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
        }
        "google" => {
            let contents = messages
                .iter()
                .filter(|message| message.role != "system")
                .map(|message| {
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
            let mut body = serde_json::json!({
                "systemInstruction": {
                    "parts": messages.iter()
                        .filter(|message| message.role == "system")
                        .map(|message| serde_json::json!({ "text": message.content }))
                        .collect::<Vec<_>>()
                },
                "contents": contents
            });
            if options.thinking {
                body["generationConfig"]["thinkingConfig"] = serde_json::json!({
                    "includeThoughts": true,
                    "thinkingBudget": options.thinking_budget,
                });
            }
            if options.json_mode {
                body["generationConfig"]["responseMimeType"] =
                    serde_json::json!("application/json");
                body["generationConfig"]["responseSchema"] = serde_json::json!({
                    "type": "OBJECT",
                    "properties": {
                        "language": { "type": "STRING", "enum": ["python", "cpp", "text"] },
                        "code": { "type": "STRING" },
                    },
                    "required": ["language", "code"],
                });
            }
            client
                .post(format!(
                    "{base_url}/models/{model}:streamGenerateContent?alt=sse"
                ))
                .header("x-goog-api-key", &api_key)
                .json(&body)
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
    let mut raw_response = Vec::new();
    let mut reply = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream failed: {e}"))?;
        raw_response.extend_from_slice(&chunk);
        buffer.extend_from_slice(&chunk);
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
            if provider == "openai" && (!has_rich_attachment || google_openai_compatibility) {
                for (kind, text) in openai_event_deltas(&event) {
                    on_delta
                        .send(ChatDelta {
                            kind,
                            text: text.clone(),
                        })
                        .map_err(|e| format!("Failed to send delta: {e}"))?;
                    if kind == "content" {
                        reply.push_str(&text);
                    }
                }
                continue;
            }
            let deltas = match provider.as_str() {
                "openai" if has_rich_attachment && !google_openai_compatibility => {
                    vec![match event["type"].as_str() {
                        Some("response.output_text.delta") => ("content", event["delta"].as_str()),
                        Some("response.reasoning_text.delta") => {
                            ("thinking", event["delta"].as_str())
                        }
                        Some("response.reasoning_summary_text.delta") => {
                            ("thinking", event["delta"].as_str())
                        }
                        _ => ("content", None),
                    }]
                }
                "openai" => Vec::new(),
                "anthropic" => vec![match event["delta"]["type"].as_str() {
                    Some("thinking_delta") => ("thinking", event["delta"]["thinking"].as_str()),
                    _ => ("content", event["delta"]["text"].as_str()),
                }],
                _ => event["candidates"][0]["content"]["parts"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|part| {
                        (
                            if part["thought"].as_bool() == Some(true) {
                                "thinking"
                            } else {
                                "content"
                            },
                            part["text"].as_str(),
                        )
                    })
                    .collect(),
            };
            for (kind, delta) in deltas {
                if let Some(text) = delta.filter(|text| !text.is_empty()) {
                    on_delta
                        .send(ChatDelta {
                            kind,
                            text: text.to_string(),
                        })
                        .map_err(|e| format!("Failed to send delta: {e}"))?;
                    if kind == "content" {
                        reply.push_str(text);
                    }
                }
            }
        }
    }
    eprintln!(
        "[AI raw provider response]\n{}",
        String::from_utf8_lossy(&raw_response)
    );
    if !buffer.is_empty() {
        let line = String::from_utf8_lossy(&buffer);
        if let Some(data) = line.trim().strip_prefix("data:") {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(data.trim()) {
                for (kind, text) in openai_event_deltas(&event) {
                    if !text.is_empty() {
                        on_delta
                            .send(ChatDelta {
                                kind,
                                text: text.clone(),
                            })
                            .map_err(|e| format!("Failed to send delta: {e}"))?;
                        if kind == "content" {
                            reply.push_str(&text);
                        }
                    }
                }
            }
        }
    }
    if reply.is_empty() && provider == "openai" {
        if let Ok(event) = serde_json::from_slice::<serde_json::Value>(&raw_response) {
            for (kind, text) in openai_event_deltas(&event) {
                on_delta
                    .send(ChatDelta {
                        kind,
                        text: text.clone(),
                    })
                    .map_err(|e| format!("Failed to send delta: {e}"))?;
                if kind == "content" {
                    reply.push_str(&text);
                }
            }
        }
    }
    if reply.is_empty() {
        return Err("Provider stream completed without any response content".to_string());
    }
    Ok(reply)
}

fn mime_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("pdf") => "application/pdf",
        Some(extension) if extension.eq_ignore_ascii_case("png") => "image/png",
        Some(extension)
            if extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg") =>
        {
            "image/jpeg"
        }
        Some(extension) if extension.eq_ignore_ascii_case("gif") => "image/gif",
        Some(extension) if extension.eq_ignore_ascii_case("webp") => "image/webp",
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
