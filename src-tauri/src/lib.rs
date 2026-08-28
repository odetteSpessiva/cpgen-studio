mod expr;
mod format;
mod lsp;
mod runner;
mod schema;
mod validate;
use lsp::{lsp_kill, lsp_send, lsp_start, GppTripleState, LspState};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_store::StoreExt;
use tauri_plugin_window_state::StateFlags;
use tokio::fs;

use crate::runner::prep_executable;

#[derive(Serialize)]
struct WorkspaceFilePayload {
    path: String,
    name: String,
    language: String,
    value: String,
}

#[derive(Serialize)]
struct SchemaLoadPayload {
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
        .map(|file_name| file_name.to_string())
        .unwrap_or_else(|| path.display().to_string());

    Ok(WorkspaceFilePayload {
        path: path.display().to_string(),
        name,
        language: infer_language(&path),
        value,
    })
}

#[tauri::command(async)]
fn save_workspace_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|error| format!("failed to save {path}: {error}"))
}

#[tauri::command(async)]
fn read_workspace_file(path: String) -> Result<WorkspaceFilePayload, String> {
    build_workspace_file(PathBuf::from(path))
}

#[tauri::command(async)]
fn pick_workspace_file(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<WorkspaceFilePayload>, String> {
    match app.dialog().file().set_parent(&window).blocking_pick_file() {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|error| format!("failed to resolve selected file: {}", error))?;
            build_workspace_file(path).map(Some)
        }
        None => Ok(None),
    }
}

#[tauri::command(async)]
fn save_file(
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
                .map_err(|error| format!("failed to save file: {}", error))?;
            std::fs::write(&path, contents)
                .map_err(|error| format!("failed to save file: {}", error))?;
            Ok(Some(path))
        }
        None => Ok(None),
    }
}

#[tauri::command(async)]
fn load_schema_file(
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
                .map_err(|error| format!("failed to resolve selected file: {}", error))?;
            let contents = std::fs::read_to_string(&path)
                .map_err(|error| format!("failed to read {}: {}", path.display(), error))?;
            Ok(Some(SchemaLoadPayload {
                path: path.display().to_string(),
                contents,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command(async)]
fn pick_directory(app: AppHandle, window: WebviewWindow) -> Result<Option<String>, String> {
    match app
        .dialog()
        .file()
        .set_parent(&window)
        .blocking_pick_folder()
    {
        Some(file_path) => {
            let path = file_path
                .into_path()
                .map_err(|error| format!("failed to resolve selected directory: {}", error))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn show_window(window: tauri::Window) {
    let win = window
        .get_webview_window("main")
        .expect("main window not found");
    win.show().expect("failed to show main window");
}

fn send_status(app: &AppHandle, step: &str, message: &str) {
    let _ = app.emit(
        "test-status",
        StatusPayload {
            step: step.to_string(),
            message: message.to_string(),
        },
    );
}

#[derive(Serialize, Clone)]
struct StatusPayload {
    step: String,
    message: String,
}
#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn generate_tests(
    app: AppHandle,
    gen_path: PathBuf,
    sol_path: PathBuf,
    output_path: PathBuf,
    test_name: String,
    test_count: i32,
    start_id: i32,
    index_as_arg: bool,
) -> Result<(), String> {
    const BATCH_SIZE: usize = 4;

    send_status(
        &app,
        "prep_executable",
        "Preparing run command for provided files",
    );

    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let compiler_path = store
        .get("compilerPath")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    let compiler_args = store
        .get("compilerArgs")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();

    let gen_command = prep_executable(&gen_path, &compiler_path, &compiler_args).await?;
    let sol_command = prep_executable(&sol_path, &compiler_path, &compiler_args).await?;

    let mut in_flight = tokio::task::JoinSet::new();
    for i in 0..test_count {
        let gen_command = gen_command.clone();
        let sol_command = sol_command.clone();
        let output_path = output_path.clone();
        let test_name = test_name.clone();
        let app = app.clone();
        in_flight.spawn(async move {
            let idx_str = (i + start_id).to_string();
            send_status(
                &app,
                "run_executable",
                format!("Generating test #{}", i + start_id).as_str(),
            );
            let test = if index_as_arg {
                let mut gen_command_with_idx = gen_command.clone();
                gen_command_with_idx.1.push(idx_str);
                runner::run(&gen_command_with_idx, Duration::from_secs(10), None).await?
            } else {
                runner::run(&gen_command, Duration::from_secs(10), Some(&idx_str)).await?
            };
            let result = runner::run(&sol_command, Duration::from_secs(10), Some(&test)).await?;
            let test_path = output_path.join(format!("{test_name}{}", i + start_id));
            fs::create_dir_all(&test_path)
                .await
                .map_err(|e| format!("Unable to create test output directory: {e}"))?;
            fs::write(test_path.join(format!("{test_name}.inp")), test)
                .await
                .map_err(|e| format!("Unable to write test: {e}"))?;
            fs::write(test_path.join(format!("{test_name}.out")), result)
                .await
                .map_err(|e| format!("Unable to write result: {e}"))?;
            Ok::<(), String>(())
        });
        if in_flight.len() >= BATCH_SIZE {
            if let Some(res) = in_flight.join_next().await {
                res.map_err(|e| format!("Test generation task panicked:\n-->{e}"))??;
            }
        }
    }
    while let Some(res) = in_flight.join_next().await {
        res.map_err(|e| format!("Test generation task panicked: {e}"))??;
    }
    send_status(
        &app,
        "finished",
        format!("Finished generating {test_count} tests.").as_str(),
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
async fn generate_tests_from_schema(
    app: AppHandle,
    schema: Vec<schema::SchemaNode>,
    sol_path: PathBuf,
    output_path: PathBuf,
    test_name: String,
    test_count: i32,
    start_id: i32,
    seed: Option<u64>,
) -> Result<(), String> {
    validate::validate(&schema).map_err(|errs| {
        errs.iter()
            .map(|e| e.to_string())
            .collect::<Vec<_>>()
            .join("\n")
    })?;

    const BATCH_SIZE: usize = 4;
    send_status(
        &app,
        "prep_executable",
        "Preparing run command for solution file",
    );

    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let compiler_path = store
        .get("compilerPath")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    let compiler_args = store
        .get("compilerArgs")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();

    let sol_command = prep_executable(&sol_path, &compiler_path, &compiler_args).await?;

    let mut in_flight = tokio::task::JoinSet::new();
    for i in 0..test_count {
        let schema = schema.clone();
        let sol_command = sol_command.clone();
        let output_path = output_path.clone();
        let test_name = test_name.clone();
        let app = app.clone();
        in_flight.spawn(async move {
            send_status(
                &app,
                "generate_input",
                format!("Generating test #{} from schema", i + start_id).as_str(),
            );
            let test_seed = seed.map(|s| s.wrapping_add(i as u64));
            let test = schema::generate(&schema, test_seed)
                .map_err(|e| format!("Schema interpretation failed: {e}"))?;
            let result = runner::run(&sol_command, Duration::from_secs(10), Some(&test)).await?;

            let test_path = output_path.join(format!("{test_name}{}", i + start_id));
            fs::create_dir_all(&test_path)
                .await
                .map_err(|e| format!("Unable to create test output directory: {e}"))?;
            fs::write(test_path.join(format!("{test_name}.inp")), &test)
                .await
                .map_err(|e| format!("Unable to write test: {e}"))?;
            fs::write(test_path.join(format!("{test_name}.out")), result)
                .await
                .map_err(|e| format!("Unable to write result: {e}"))?;
            Ok::<(), String>(())
        });
        if in_flight.len() >= BATCH_SIZE {
            if let Some(res) = in_flight.join_next().await {
                res.map_err(|e| format!("Test generation task panicked: {e}"))??;
            }
        }
    }
    while let Some(res) = in_flight.join_next().await {
        res.map_err(|e| format!("Test generation task panicked: {e}"))??;
    }
    send_status(
        &app,
        "finished",
        format!("Finished generating {test_count} tests.").as_str(),
    );
    Ok(())
}

#[tauri::command(async)]
fn preview_schema(schema: Vec<schema::SchemaNode>, seed: Option<u64>) -> Result<String, String> {
    schema::generate(&schema, seed)
}

struct WatcherState(Mutex<HashMap<String, RecommendedWatcher>>);

#[tauri::command]
fn watch_file(
    app: AppHandle,
    path: String,
    state: tauri::State<WatcherState>,
) -> Result<(), String> {
    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                for changed_path in event.paths {
                    let _ =
                        app_handle.emit("file-changed", changed_path.to_string_lossy().to_string());
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    state.0.lock().unwrap().insert(path, watcher);
    Ok(())
}

#[tauri::command]
fn unwatch_file(state: tauri::State<WatcherState>, path: String) -> Result<(), String> {
    state.0.lock().unwrap().remove(&path);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() ^ StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(WatcherState(Mutex::new(HashMap::new())))
        .manage(LspState(tokio::sync::Mutex::new(HashMap::new())))
        .manage(GppTripleState(tokio::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            read_workspace_file,
            pick_workspace_file,
            show_window,
            pick_directory,
            generate_tests,
            generate_tests_from_schema,
            preview_schema,
            save_workspace_file,
            save_file,
            load_schema_file,
            watch_file,
            unwatch_file,
            lsp_start,
            lsp_send,
            lsp_kill
        ])
        .setup(|app| {
            let version = app.package_info().version.to_string();
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("CPGen Studio {}", version))?;
            }

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let handle = handle.clone();
                let handle_inner = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    if let Some(win) = handle_inner.get_webview_window("main") {
                        if !win.is_visible().unwrap_or(false) {
                            let _ = win.show();
                            handle_inner
                                .dialog()
                                .message("The app took longer than expected to load.")
                                .title("Startup warning")
                                .blocking_show();
                        }
                    }
                });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{build_workspace_file, infer_language, read_workspace_file, save_workspace_file};
    use crate::schema::{Charset, SchemaNode};
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
        std::env::temp_dir().join(format!("cpgen-studio-lib-tests-{unique}"))
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
            let path = std::path::Path::new(file_name);
            assert_eq!(infer_language(path), expected);
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
            let path = std::path::Path::new(file_name);
            assert_eq!(infer_language(path), expected);
        }
    }

    #[test]
    fn build_workspace_file_returns_error_for_missing_file() {
        let file_path = temp_dir().join("does_not_exist.py");
        let result = build_workspace_file(file_path);
        assert!(matches!(result, Err(err) if err.contains("failed to read")));
    }

    #[test]
    fn preview_schema_generates_expected_output() {
        let schema = vec![
            SchemaNode::Int {
                var_name: None,
                min: "2".to_string(),
                max: "2".to_string(),
                output_format: None,
            },
            SchemaNode::Loop {
                count: "2".to_string(),
                children: vec![SchemaNode::String {
                    var_name: None,
                    length: "3".to_string(),
                    charset: Charset::Digits,
                    custom_charset: None,
                }],
            },
        ];

        let result = super::preview_schema(schema, Some(7)).unwrap();
        let lines: Vec<&str> = result.lines().collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "2");
        assert_eq!(lines[1].len(), 3);
        assert!(lines[1].chars().all(|c| c.is_ascii_digit()));
        assert_eq!(lines[2].len(), 3);
    }

    #[test]
    fn preview_schema_propagates_invalid_schema_error() {
        let schema = vec![SchemaNode::Int {
            var_name: None,
            min: "10".to_string(),
            max: "1".to_string(),
            output_format: None,
        }];

        let result = super::preview_schema(schema, Some(1));
        assert!(matches!(result, Err(err) if err.contains("greater than max")));
    }
}
