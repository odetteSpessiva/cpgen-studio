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
pub(crate) async fn delete_key(key: String) -> Result<(), String> {
    validate_key_name(&key)?;
    with_entry(key, |entry| match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    })
    .await
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
