use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use genai::{
    adapter::AdapterKind,
    chat::{
        ChatMessage as AiMessage, ChatOptions as AiOptions, ChatRequest, ChatResponseFormat,
        ChatRole, ChatStreamEvent, ContentPart, JsonSpec, MessageContent, ReasoningEffort,
    },
    resolver::{AuthData, Endpoint},
    Client, ModelIden, ServiceTarget, WebConfig,
};
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

fn is_google_openai_compatibility_url(base_url: &str) -> bool {
    base_url
        .to_ascii_lowercase()
        .contains("generativelanguage.googleapis.com/v1beta/openai")
}

fn is_openrouter_url(base_url: &str) -> bool {
    base_url.to_ascii_lowercase().contains("openrouter.ai")
}

fn is_pdf(file: &ChatAttachment) -> bool {
    file.mime_type == "application/pdf"
}

fn is_image(file: &ChatAttachment) -> bool {
    file.mime_type.starts_with("image/")
}

fn attachment_part(provider: &str, file: &ChatAttachment) -> ContentPart {
    // Anthropic only accepts PDFs and images as binary parts; anything else
    // was previously sent as a text placeholder.
    if provider == "anthropic" && !is_pdf(file) && !is_image(file) {
        return ContentPart::from_text(
            file.text
                .as_deref()
                .unwrap_or("The attached file has no text representation."),
        );
    }
    ContentPart::from_binary_base64(
        file.mime_type.clone(),
        file.data_base64.clone(),
        Some(file.name.clone()),
    )
}

fn parse_effort(effort: &str) -> Result<ReasoningEffort, String> {
    effort
        .parse::<ReasoningEffort>()
        .map_err(|_| format!("Unsupported reasoning effort: {effort}"))
}

fn describe_error(error: genai::Error, context: &str) -> String {
    match error {
        genai::Error::HttpError { status, body, .. } => {
            format!("Provider returned {status}: {body}")
        }
        genai::Error::ChatResponse { body, .. } => match body["error"]["message"].as_str() {
            Some(message) => format!("Provider error: {message}"),
            None => format!("Provider error: {body}"),
        },
        other => format!("{context}: {other}"),
    }
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
    let base_url = base_url.trim_end_matches('/');
    let has_pdf = attachment.as_ref().is_some_and(is_pdf);
    let has_rich_attachment = attachment
        .as_ref()
        .is_some_and(|file| is_pdf(file) || is_image(file));
    let google_openai_compatibility = is_google_openai_compatibility_url(base_url);
    let openrouter = is_openrouter_url(base_url);
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

    // OpenAI rich attachments use Responses; OpenRouter remains on its
    // Chat Completions-compatible adapter.
    let adapter_kind = match provider.as_str() {
        "openai" if has_rich_attachment && !google_openai_compatibility && !openrouter => {
            AdapterKind::OpenAIResp
        }
        "openai" if openrouter => AdapterKind::OpenRouter,
        "openai" => AdapterKind::OpenAI,
        "anthropic" => AdapterKind::Anthropic,
        "google" => AdapterKind::Gemini,
        _ => return Err(format!("Unknown provider: {provider}")),
    };

    // -- Messages
    let should_attach = |index: usize, message: &ChatMessage| match provider.as_str() {
        "openai" => has_rich_attachment && Some(index) == attachment_message_index,
        "anthropic" => Some(index) == attachment_message_index,
        _ => {
            attachment_message_index.is_some()
                && message.role == "user"
                && message.content.starts_with("Attached problem")
        }
    };
    let mut ai_messages = Vec::with_capacity(messages.len());
    for (index, message) in messages.iter().enumerate() {
        let role = match message.role.as_str() {
            "system" => ChatRole::System,
            "assistant" => ChatRole::Assistant,
            "user" => ChatRole::User,
            other => return Err(format!("Unsupported message role: {other}")),
        };
        let content = match attachment
            .as_ref()
            .filter(|_| should_attach(index, message))
        {
            Some(file) => MessageContent::from_parts(vec![
                ContentPart::from_text(message.content.clone()),
                attachment_part(&provider, file),
            ]),
            None => MessageContent::from_text(message.content.clone()),
        };
        ai_messages.push(AiMessage::new(role, content));
    }
    let request = ChatRequest::new(ai_messages);

    // -- Options
    let mut chat_options = AiOptions::default();
    if options.thinking {
        chat_options = chat_options.with_capture_reasoning_content(true);
    }
    match adapter_kind {
        AdapterKind::OpenAIResp => {
            if options.thinking {
                chat_options = chat_options.with_reasoning_effort(parse_effort(&options.effort)?);
            }
            if options.json_mode {
                chat_options = chat_options.with_response_format(ChatResponseFormat::JsonMode);
            }
        }
        AdapterKind::OpenAI | AdapterKind::OpenRouter => {
            if options.thinking && base_url.contains("openrouter.ai") {
                let reasoning = if options.thinking_budget > 0 {
                    serde_json::json!({ "max_tokens": options.thinking_budget })
                } else {
                    serde_json::json!({ "effort": options.effort })
                };
                chat_options =
                    chat_options.with_extra_body(serde_json::json!({ "reasoning": reasoning }));
            } else if options.thinking && google_openai_compatibility {
                chat_options = chat_options.with_extra_body(serde_json::json!({
                    "extra_body": {
                        "google": {
                            "thinking_config": {
                                "thinking_level": options.effort,
                                "include_thoughts": true,
                            }
                        }
                    }
                }));
            } else if options.thinking {
                chat_options = chat_options.with_reasoning_effort(parse_effort(&options.effort)?);
            }
            if options.json_mode {
                chat_options = chat_options.with_response_format(ChatResponseFormat::JsonMode);
            }
        }
        AdapterKind::Anthropic => {
            chat_options = chat_options.with_max_tokens(options.max_tokens);
            if options.thinking {
                if options.thinking_budget < 1024
                    || options.thinking_budget as u32 >= options.max_tokens
                {
                    return Err(format!(
                        "Anthropic thinking budget must be at least 1024 and below max tokens ({})",
                        options.max_tokens
                    ));
                }
                chat_options = chat_options
                    .with_reasoning_effort(ReasoningEffort::Budget(options.thinking_budget as u32));
            }
            // json_mode has never been applied for Anthropic.
        }
        _ => {
            // Google (native)
            // thinking_budget == -1 means "let the model decide" (dynamic thinking).
            // genai's Budget is a u32, so for negative values no explicit budget is
            // set and Gemini falls back to its dynamic default; thoughts are still
            // requested via capture_reasoning_content above.
            if options.thinking {
                if let Ok(budget) = u32::try_from(options.thinking_budget) {
                    chat_options =
                        chat_options.with_reasoning_effort(ReasoningEffort::Budget(budget));
                }
            }
            if options.json_mode {
                chat_options =
                    chat_options.with_response_format(ChatResponseFormat::JsonSpec(JsonSpec::new(
                        "chat_response",
                        serde_json::json!({
                            "type": "object",
                            "properties": {
                                "language": { "type": "string", "enum": ["python", "cpp", "text"] },
                                "code": { "type": "string" },
                            },
                            "required": ["language", "code"],
                        }),
                    )));
            }
        }
    }

    // -- Client / target (custom base URL + key, adapter picked explicitly)
    let client = Client::builder()
        .with_web_config(WebConfig::default().with_timeout(std::time::Duration::from_secs(60)))
        .build()
        .map_err(|e| format!("Failed creating client: {e}"))?;
    let target = ServiceTarget {
        endpoint: Endpoint::from_owned(format!("{base_url}/")),
        auth: AuthData::from_single(api_key),
        model: ModelIden::new(adapter_kind, model),
    };

    let response = client
        .exec_chat_stream(target, request, Some(&chat_options))
        .await
        .map_err(|e| describe_error(e, "Request failed"))?;

    let mut stream = response.stream;
    let mut reply = String::new();
    while let Some(event) = stream.next().await {
        let event = event.map_err(|e| describe_error(e, "Stream failed"))?;
        let (kind, text) = match event {
            ChatStreamEvent::Chunk(chunk) => ("content", chunk.content),
            ChatStreamEvent::ReasoningChunk(chunk) => ("thinking", chunk.content),
            _ => continue,
        };
        if text.is_empty() {
            continue;
        }
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
