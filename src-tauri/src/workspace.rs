use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub(crate) struct WorkspaceFilePayload {
    path: String,
    name: String,
    language: String,
    value: String,
}

#[derive(Serialize)]
pub(crate) struct SchemaLoadPayload {
    path: String,
    contents: String,
}

fn infer_language(path: &Path) -> String {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase());
    match extension.as_deref() {
        Some("py") => "python".to_string(),
        Some("cpp") | Some("cc") | Some("cxx") | Some("hpp") | Some("h") => "cpp".to_string(),
        Some("ts") | Some("tsx") => "typescript".to_string(),
        Some("js") | Some("jsx") => "javascript".to_string(),
        Some("json") => "json".to_string(),
        Some("md") => "markdown".to_string(),
        _ => "plaintext".to_string(),
    }
}

fn build_workspace_file(path: PathBuf) -> Result<WorkspaceFilePayload, String> {
    let value = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {}", path.display(), error))?;
    let name = path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.display().to_string());
    Ok(WorkspaceFilePayload {
        path: path.display().to_string(),
        name,
        language: infer_language(&path),
        value,
    })
}

#[tauri::command(async)]
pub(crate) fn save_workspace_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|error| format!("failed to save {path}: {error}"))
}

#[tauri::command(async)]
pub(crate) fn read_workspace_file(path: String) -> Result<WorkspaceFilePayload, String> {
    build_workspace_file(PathBuf::from(path))
}

#[tauri::command(async)]
pub(crate) fn pick_workspace_file(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<WorkspaceFilePayload>, String> {
    match app.dialog().file().set_parent(&window).blocking_pick_file() {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|error| format!("failed to resolve selected file: {error}"))?;
            build_workspace_file(path).map(Some)
        }
        None => Ok(None),
    }
}

#[tauri::command(async)]
pub(crate) fn save_file(
    app: AppHandle,
    window: WebviewWindow,
    contents: String,
) -> Result<Option<PathBuf>, String> {
    match app
        .dialog()
        .file()
        .set_file_name("schema.json")
        .add_filter("json", &["json"])
        .set_parent(&window)
        .blocking_save_file()
    {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|error| format!("failed to save file: {error}"))?;
            std::fs::write(&path, contents)
                .map_err(|error| format!("failed to save file: {error}"))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

#[tauri::command(async)]
pub(crate) fn load_schema_file(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<SchemaLoadPayload>, String> {
    match app
        .dialog()
        .file()
        .add_filter("json", &["json"])
        .set_parent(&window)
        .blocking_pick_file()
    {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|error| format!("failed to resolve selected file: {error}"))?;
            let contents = std::fs::read_to_string(&path)
                .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
            Ok(Some(SchemaLoadPayload {
                path: path.display().to_string(),
                contents,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub(crate) fn pick_directory(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    match app
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder()
    {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|error| format!("failed to resolve selected directory: {error}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::{build_workspace_file, infer_language, read_workspace_file, save_workspace_file};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("cpgen-studio-workspace-tests-{unique}"))
    }

    #[test]
    fn infer_language_handles_common_extensions() {
        let cases = [
            ("script.py", "python"),
            ("main.cpp", "cpp"),
            ("component.tsx", "typescript"),
            ("index.js", "javascript"),
            ("schema.json", "json"),
            ("readme.md", "markdown"),
            ("notes.txt", "plaintext"),
            ("README", "plaintext"),
        ];

        for (file_name, expected) in cases {
            assert_eq!(infer_language(std::path::Path::new(file_name)), expected);
        }
    }

    #[test]
    fn build_workspace_file_reads_metadata_and_contents() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("workspace.py");
        let contents = "print('build workspace file')\n";
        fs::write(&file_path, contents).unwrap();

        let payload = build_workspace_file(file_path.clone()).unwrap();

        assert_eq!(payload.path, file_path.to_string_lossy().to_string());
        assert_eq!(payload.name, "workspace.py");
        assert_eq!(payload.language, "python");
        assert_eq!(payload.value, contents);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_and_read_workspace_file_round_trip() {
        let dir = temp_dir();
        fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("example.py");
        let contents = "print('hello from tests')\n";

        save_workspace_file(
            file_path.to_string_lossy().to_string(),
            contents.to_string(),
        )
        .unwrap();
        let loaded = read_workspace_file(file_path.to_string_lossy().to_string()).unwrap();

        assert_eq!(loaded.path, file_path.to_string_lossy().to_string());
        assert_eq!(loaded.name, "example.py");
        assert_eq!(loaded.language, "python");
        assert_eq!(loaded.value, contents);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn infer_language_handles_case_insensitive_and_default_extensions() {
        let cases = [
            ("script.PY", "python"),
            ("main.CPP", "cpp"),
            ("component.TS", "typescript"),
            ("asset.MD", "markdown"),
            ("notes.unknown", "plaintext"),
            ("no_extension", "plaintext"),
        ];

        for (file_name, expected) in cases {
            assert_eq!(infer_language(std::path::Path::new(file_name)), expected);
        }
    }

    #[test]
    fn build_workspace_file_returns_error_for_missing_file() {
        let result = build_workspace_file(temp_dir().join("does_not_exist.py"));
        assert!(matches!(result, Err(error) if error.contains("failed to read")));
    }
}
