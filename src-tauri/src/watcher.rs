use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

pub(crate) struct WatcherState(pub(crate) Mutex<HashMap<String, RecommendedWatcher>>);

#[tauri::command]
pub(crate) fn watch_file(
    app: AppHandle,
    path: String,
    state: tauri::State<WatcherState>,
) -> Result<(), String> {
    let app_handle = app.clone();
    let target_path = PathBuf::from(&path);
    let target_path = target_path
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(&path));
    let parent_path = target_path
        .parent()
        .ok_or_else(|| format!("path has no parent: {path}"))?
        .to_path_buf();
    let target_name = target_path
        .file_name()
        .ok_or_else(|| format!("path has no file name: {path}"))?
        .to_os_string();
    let emitted_path = path.clone();
    let last_emitted = Arc::new(Mutex::new(None::<(String, Instant)>));
    let last_emitted_for_callback = Arc::clone(&last_emitted);
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                for changed_path in event.paths {
                    if changed_path.file_name() != Some(target_name.as_os_str()) {
                        continue;
                    }
                    let payload = emitted_path.clone();
                    let should_emit = {
                        let mut last = last_emitted_for_callback.lock().unwrap();
                        let duplicate = last.as_ref().is_some_and(|(path, timestamp)| {
                            path == &payload && timestamp.elapsed() < Duration::from_millis(100)
                        });
                        if !duplicate {
                            *last = Some((payload.clone(), Instant::now()));
                        }
                        !duplicate
                    };
                    if !should_emit {
                        continue;
                    }
                    let _ = app_handle.emit("file-changed", &payload);
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&parent_path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    state.0.lock().unwrap().insert(path, watcher);
    Ok(())
}

#[tauri::command]
pub(crate) fn unwatch_file(state: tauri::State<WatcherState>, path: String) -> Result<(), String> {
    state.0.lock().unwrap().remove(&path);
    Ok(())
}
