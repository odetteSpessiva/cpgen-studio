use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

const KEYRING_SERVICE: &str = "cpgen-studio";

fn validate_key_name(key: &str) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("Key name cannot be empty".to_string());
    }
    Ok(())
}

fn validate_key_input(key: &str, value: &str) -> Result<(), String> {
    validate_key_name(key)?;
    if value.is_empty() {
        return Err("Value cannot be empty".to_string());
    }
    Ok(())
}

async fn with_entry<T, F>(key: String, op: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(keyring::Entry) -> keyring::Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        keyring::Entry::new(KEYRING_SERVICE, key.trim()).and_then(op)
    })
    .await
    .map_err(|e| format!("Keychain task failed: {e}"))?
    .map_err(|e| format!("System keychain error: {e}"))
}

#[tauri::command]
pub(crate) async fn save_key(key: String, value: String) -> Result<(), String> {
    validate_key_input(&key, &value)?;
    with_entry(key, move |entry| entry.set_password(&value)).await
}

#[tauri::command]
pub(crate) async fn has_key(key: String) -> Result<bool, String> {
    validate_key_name(&key)?;
    with_entry(key, |entry| match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e),
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_key(key: String) -> Result<Option<String>, String> {
    validate_key_name(&key)?;
    with_entry(key, |entry| match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_key(key: String) -> Result<(), String> {
    validate_key_name(&key)?;
    with_entry(key, |entry| match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    })
    .await
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(alias = "models")]
    data: Vec<ModelEntry>,
    has_more: Option<bool>,
    last_id: Option<String>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: Option<String>,
    name: Option<String>,
    #[serde(rename = "supportedGenerationMethods")]
    supported_generation_methods: Option<Vec<String>>,
    #[serde(default)]
    capabilities: serde_json::Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelInfo {
    id: String,
    image_input: Option<bool>,
    pdf_input: Option<bool>,
}

#[tauri::command]
pub(crate) async fn list_models(
    provider: String,
    base_url: String,
    on_page: Channel<Vec<ModelInfo>>,
) -> Result<Vec<ModelInfo>, String> {
    let api_key = get_key(provider.clone())
        .await?
        .ok_or("No API key saved for this provider")?;

    let client = reqwest::Client::new();
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let mut all_models = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut request = match provider.as_str() {
            "openai" => client.get(&url).bearer_auth(&api_key),
            "anthropic" => client
                .get(&url)
                .query(&[("limit", "1000")])
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01"),
            "google" => client
                .get(&url)
                .query(&[("pageSize", "1000")])
                .header("x-goog-api-key", &api_key),
            _ => return Err(format!("Unknown provider: {provider}")),
        };
        if let Some(cursor) = &cursor {
            let name = if provider == "anthropic" {
                "after_id"
            } else {
                "pageToken"
            };
            request = request.query(&[(name, cursor)]);
        }

        let response = request
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;
        let status = response.status();
        let body = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response: {e}"))?;
        if !status.is_success() {
            return Err(format!(
                "Provider returned {status}: {}",
                String::from_utf8_lossy(&body)
            ));
        }

        let parsed: ModelsResponse =
            serde_json::from_slice(&body).map_err(|e| format!("Unexpected response: {e}"))?;
        let next = if parsed.has_more == Some(true) {
            parsed.last_id
        } else {
            parsed.next_page_token.filter(|token| !token.is_empty())
        };
        let page: Vec<ModelInfo> = parsed
            .data
            .into_iter()
            .filter(|m| {
                m.supported_generation_methods
                    .as_ref()
                    .is_none_or(|methods| methods.iter().any(|method| method == "generateContent"))
            })
            .filter_map(|m| {
                Some(ModelInfo {
                    id: m.id.or(m.name)?.trim_start_matches("models/").to_string(),
                    image_input: m.capabilities["image_input"]["supported"].as_bool(),
                    pdf_input: m.capabilities["pdf_input"]["supported"].as_bool(),
                })
            })
            .collect();
        on_page
            .send(page.clone())
            .map_err(|e| format!("Failed to send models: {e}"))?;
        all_models.extend(page);

        if next.is_none() || next == cursor {
            break;
        }
        cursor = next;
    }
    all_models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(all_models)
}

#[cfg(test)]
mod tests {
    use super::{validate_key_input, validate_key_name};

    #[test]
    fn rejects_empty_key_name() {
        assert!(matches!(validate_key_name("  "), Err(e) if e.contains("name")));
        assert!(matches!(validate_key_input("  ", "secret"), Err(e) if e.contains("name")));
    }

    #[test]
    fn rejects_empty_value() {
        let result = validate_key_input("openai", "");
        assert!(matches!(result, Err(e) if e.contains("Value")));
    }

    #[test]
    fn accepts_valid_input() {
        assert!(validate_key_name("openai").is_ok());
        assert!(validate_key_input("openai", "sk-test").is_ok());
    }
}
