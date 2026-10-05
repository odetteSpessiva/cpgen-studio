use serde::Serialize;
use std::{
    fs,
    io::copy,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

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

fn ai_instance_directory(instance_id: &str, instance_name: &str) -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "Unable to determine user home directory".to_string())?;
    let safe_name: String = instance_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .replace(' ', "_");
    let safe_name = if safe_name.is_empty() {
        "instance"
    } else {
        &safe_name
    };
    Ok(home
        .join("cpgen-studio")
        .join(format!("{safe_name}-{instance_id}")))
}

#[tauri::command]
pub(crate) fn save_ai_generated_file(
    contents: String,
    language: String,
    slot: String,
    instance_id: String,
    instance_name: String,
) -> Result<String, String> {
    let extension = match language.trim().to_ascii_lowercase().as_str() {
        "python" => "py",
        "cpp" | "c++" => "cpp",
        "javascript" => "js",
        "typescript" => "ts",
        _ => "txt",
    };
    let prefix = if slot == "solution" { "sol" } else { "gen" };
    let directory = ai_instance_directory(&instance_id, &instance_name)?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "failed to create AI instance directory {}: {error}",
            directory.display()
        )
    })?;
    let path = directory.join(format!("{prefix}.{extension}"));
    fs::write(&path, contents)
        .map_err(|error| format!("failed to save generated file {}: {error}", path.display()))?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub(crate) fn delete_ai_instance_directory(
    instance_id: String,
    instance_name: String,
) -> Result<(), String> {
    let directory = ai_instance_directory(&instance_id, &instance_name)?;
    let parent = directory
        .parent()
        .ok_or_else(|| "failed to determine AI instance directory parent".to_string())?;
    if parent.exists() {
        let suffix = format!("-{instance_id}");
        for entry in fs::read_dir(parent)
            .map_err(|error| format!("failed to read AI instance directory parent: {error}"))?
        {
            let entry = entry
                .map_err(|error| format!("failed to inspect AI instance directory: {error}"))?;
            let path = entry.path();
            if path.is_dir()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(&suffix))
            {
                fs::remove_dir_all(&path).map_err(|error| {
                    format!(
                        "failed to remove AI instance directory {}: {error}",
                        path.display()
                    )
                })?;
            }
        }
    }
    Ok(())
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

fn zip_directory(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.exists() {
        return Err("Directory does not exist".to_string());
    }
    let src_canonical = src.canonicalize().map_err(|e| e.to_string())?;

    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            let _ = fs::create_dir_all(parent);
        }
    }

    let dest_parent = dest.parent().filter(|p| !p.as_os_str().is_empty());
    if let Some(parent) = dest_parent {
        let parent_canonical = parent.canonicalize().map_err(|e| e.to_string())?;
        if parent_canonical.starts_with(&src_canonical) {
            return Err("Destination inside source".to_string());
        }
    }

    let file = fs::File::create(dest).map_err(|e| e.to_string())?;

    let dir_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o755);
    let file_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let walker = WalkDir::new(src);
    let iter = walker.into_iter().filter_map(|e| e.ok());
    let mut zip = ZipWriter::new(file);

    for entry in iter {
        let path = entry.path();
        let relative_path = match path.strip_prefix(src) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if relative_path.as_os_str().is_empty() {
            continue;
        }

        let name = relative_path
            .components()
            .map(|c| c.as_os_str().to_str())
            .collect::<Option<Vec<_>>>()
            .map(|parts| parts.join("/"));

        let name = match name {
            Some(p) => p,
            None => continue,
        };

        if path.is_dir() {
            let _ = zip.add_directory(&name, dir_options);
        } else if path.is_file() {
            let mut f = match fs::File::open(path) {
                Ok(file) => file,
                Err(_) => continue,
            };
            if zip.start_file(&name, file_options).is_ok() {
                copy(&mut f, &mut zip).map_err(|e| format!("Failed reading file: {e}"))?;
            }
        }
    }

    zip.finish()
        .map_err(|e| format!("Unable to finish zip archive: {e}"))?;
    Ok(())
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
    file_name: Option<String>,
    extension: Option<String>,
) -> Result<Option<PathBuf>, String> {
    let file_name = file_name.unwrap_or_else(|| "schema.json".to_string());
    let extension = extension.unwrap_or_else(|| "json".to_string());
    match app
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter(&extension, &[extension.as_str()])
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

#[tauri::command(async)]
pub(crate) fn export_tests(
    tests_dir: String,
    test_name: String,
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    match app
        .dialog()
        .file()
        .set_file_name(format!("{test_name}.zip"))
        .add_filter("zip", &["zip"])
        .set_parent(&window)
        .blocking_save_file()
    {
        Some(path) => zip_directory(
            &PathBuf::from(tests_dir),
            &path
                .into_path()
                .map_err(|e| format!("Failed to resolve path: {e}"))?,
        )
        .map_err(|e| format!("Unable to export tests: {e}")),
        None => Ok(()),
    }
}

#[tauri::command(async)]
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
