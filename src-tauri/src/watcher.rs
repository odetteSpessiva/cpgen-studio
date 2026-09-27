use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{collections::HashMap, path::Path, sync::Mutex};
use tauri::{AppHandle, Emitter};

pub(crate) struct WatcherState(pub(crate) Mutex<HashMap<String, RecommendedWatcher>>);

#[tauri::command]
pub(crate) fn watch_file(
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
pub(crate) fn unwatch_file(state: tauri::State<WatcherState>, path: String) -> Result<(), String> {
    state.0.lock().unwrap().remove(&path);
    Ok(())
}
