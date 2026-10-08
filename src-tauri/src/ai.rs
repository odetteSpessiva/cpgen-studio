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

#[derive(Clone, Serialize, Debug)]
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
    use super::*;

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

    #[test]
    fn accepts_key_name_with_surrounding_whitespace() {
        assert!(validate_key_name("  openai  ").is_ok());
    }

    #[test]
    fn accepts_whitespace_only_value() {
        // Only a completely empty value is rejected.
        assert!(validate_key_input("openai", " ").is_ok());
    }

    #[test]
    fn name_is_validated_before_value() {
        let result = validate_key_input("", "");
        assert!(matches!(result, Err(e) if e.contains("name")));
    }

    #[test]
    fn save_key_rejects_invalid_input_before_touching_keychain() {
        let empty_name = tauri::async_runtime::block_on(save_key(" ".to_string(), "v".to_string()));
        assert!(matches!(empty_name, Err(e) if e.contains("name")));

        let empty_value =
            tauri::async_runtime::block_on(save_key("openai".to_string(), String::new()));
        assert!(matches!(empty_value, Err(e) if e.contains("Value")));
    }

    #[test]
    fn has_get_delete_reject_empty_key_name() {
        let has = tauri::async_runtime::block_on(has_key(" ".to_string()));
        assert!(matches!(has, Err(e) if e.contains("name")));

        let get = tauri::async_runtime::block_on(get_key(" ".to_string()));
        assert!(matches!(get, Err(e) if e.contains("name")));

        let delete = tauri::async_runtime::block_on(delete_key(" ".to_string()));
        assert!(matches!(delete, Err(e) if e.contains("name")));
    }

    #[test]
    fn save_key_succeeds() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let result =
            tauri::async_runtime::block_on(save_key("openai".to_string(), "sk-test".to_string()));
        assert!(result.is_ok());
    }

    #[test]
    fn missing_key_is_reported_as_absent() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let has = tauri::async_runtime::block_on(has_key("openai".to_string()));
        assert!(matches!(has, Ok(false)));

        let get = tauri::async_runtime::block_on(get_key("openai".to_string()));
        assert!(matches!(get, Ok(None)));
    }

    #[test]
    fn deleting_missing_key_is_ok() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let result = tauri::async_runtime::block_on(delete_key("openai".to_string()));
        assert!(result.is_ok());
    }

    #[test]
    fn parses_openai_models_response() {
        let parsed: ModelsResponse =
            serde_json::from_str(r#"{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}"#).unwrap();
        assert_eq!(parsed.data.len(), 2);
        assert_eq!(parsed.data[0].id.as_deref(), Some("gpt-4o"));
        assert!(parsed.has_more.is_none());
        assert!(parsed.last_id.is_none());
        assert!(parsed.next_page_token.is_none());
    }

    #[test]
    fn parses_anthropic_models_response_with_capabilities_and_paging() {
        let parsed: ModelsResponse = serde_json::from_str(
            r#"{
                "data": [{
                    "id": "claude-x",
                    "capabilities": {
                        "image_input": { "supported": true },
                        "pdf_input": { "supported": false }
                    }
                }],
                "has_more": true,
                "last_id": "claude-x"
            }"#,
        )
        .unwrap();
        let entry = &parsed.data[0];
        assert_eq!(
            entry.capabilities["image_input"]["supported"].as_bool(),
            Some(true)
        );
        assert_eq!(
            entry.capabilities["pdf_input"]["supported"].as_bool(),
            Some(false)
        );
        assert_eq!(parsed.has_more, Some(true));
        assert_eq!(parsed.last_id.as_deref(), Some("claude-x"));
    }

    #[test]
    fn parses_google_models_response_with_alias_and_page_token() {
        let parsed: ModelsResponse = serde_json::from_str(
            r#"{
                "models": [{
                    "name": "models/gemini-x",
                    "supportedGenerationMethods": ["generateContent", "countTokens"]
                }],
                "nextPageToken": "abc"
            }"#,
        )
        .unwrap();
        let entry = &parsed.data[0];
        assert!(entry.id.is_none());
        assert_eq!(entry.name.as_deref(), Some("models/gemini-x"));
        assert_eq!(
            entry.supported_generation_methods.as_deref(),
            Some(["generateContent".to_string(), "countTokens".to_string()].as_slice())
        );
        assert_eq!(parsed.next_page_token.as_deref(), Some("abc"));
    }

    #[test]
    fn missing_capabilities_read_as_unknown() {
        let parsed: ModelsResponse = serde_json::from_str(r#"{"data":[{"id":"m"}]}"#).unwrap();
        let entry = &parsed.data[0];
        assert_eq!(
            entry.capabilities["image_input"]["supported"].as_bool(),
            None
        );
        assert_eq!(entry.capabilities["pdf_input"]["supported"].as_bool(), None);
    }

    #[test]
    fn models_response_requires_data_list() {
        assert!(serde_json::from_str::<ModelsResponse>(r#"{"has_more":false}"#).is_err());
    }

    #[test]
    fn model_info_serializes_camel_case_with_nulls() {
        let info = ModelInfo {
            id: "m".to_string(),
            image_input: None,
            pdf_input: Some(true),
        };
        assert_eq!(
            serde_json::to_string(&info).unwrap(),
            r#"{"id":"m","imageInput":null,"pdfInput":true}"#
        );
    }

    #[test]
    fn list_models_requires_saved_key() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let result = tauri::async_runtime::block_on(list_models(
            "openai".to_string(),
            "https://api.openai.com/v1".to_string(),
            Channel::new(|_| Ok(())),
        ));
        assert_eq!(result.unwrap_err(), "No API key saved for this provider");
    }
}
