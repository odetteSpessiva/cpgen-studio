mod ai;
mod chat;
mod cmp_expr;
mod expr;
mod format;
mod generation;
mod lsp;
mod mingw_installer;
mod runner;
mod schema;
mod validate;
mod watcher;
mod workspace;

use ai::{delete_key, get_key, has_key, list_models, save_key};
use chat::{pick_chat_attachment, send_message};
use generation::{generate_tests, generate_tests_from_schema, preview_schema};
use lsp::{lsp_kill, lsp_send, lsp_start, GppTripleState, LspState};
use mingw_installer::{cancel_mingw, check_compiler, download_mingw, DownloadState};
use std::{collections::HashMap, sync::Mutex};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_window_state::StateFlags;
use watcher::{unwatch_file, watch_file, WatcherState};
use workspace::{
    delete_ai_instance_directory, export_tests, load_schema_file, pick_directory,
    pick_workspace_file, read_workspace_file, save_ai_generated_file, save_file,
    save_workspace_file,
};

#[tauri::command]
fn show_window(window: tauri::Window) {
    let win = window
        .get_webview_window("main")
        .expect("main window not found");
    win.show().expect("failed to show main window");
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationNotificationPayload {
    instance_id: String,
    chat_tab: String,
}

#[tauri::command]
fn send_generation_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    instance_id: String,
    chat_tab: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let payload = GenerationNotificationPayload {
            instance_id,
            chat_tab,
        };
        let callback_app = app.clone();
        tauri_winrt_notification::Toast::new("me.chisa.cpgen-studio")
            .title(&title)
            .text1(&body)
            .on_activated(move |_| {
                let _ = callback_app.emit("generation-notification-clicked", &payload);
                Ok(())
            })
            .show()
            .map_err(|error| format!("failed to show generation notification: {error}"))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let payload = GenerationNotificationPayload {
            instance_id,
            chat_tab,
        };
        let callback_app = app.clone();
        let mut notification = notify_rust::Notification::new();
        notification
            .summary(&title)
            .body(&body)
            .action("default", "Open CPGen Studio");
        let handle = notification
            .show()
            .map_err(|error| format!("failed to show generation notification: {error}"))?;
        std::thread::spawn(move || {
            handle.wait_for_action(|action| {
                if action == "default" {
                    let _ = callback_app.emit("generation-notification-clicked", &payload);
                }
            });
        });
        return Ok(());
    }

    #[cfg(all(not(windows), not(target_os = "linux")))]
    {
        let _ = (app, title, body, instance_id, chat_tab);
        Err("native generation notifications are only supported on Windows".to_string())
    }
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
        .manage(DownloadState(std::sync::atomic::AtomicBool::new(false)))
        .manage(LspState(tokio::sync::Mutex::new(HashMap::new())))
        .manage(GppTripleState(tokio::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            read_workspace_file,
            pick_workspace_file,
            show_window,
            send_generation_notification,
            pick_directory,
            generate_tests,
            generate_tests_from_schema,
            preview_schema,
            save_workspace_file,
            save_ai_generated_file,
            delete_ai_instance_directory,
            save_file,
            load_schema_file,
            export_tests,
            watch_file,
            unwatch_file,
            lsp_start,
            lsp_send,
            lsp_kill,
            download_mingw,
            cancel_mingw,
            check_compiler,
            save_key,
            has_key,
            delete_key,
            get_key,
            list_models,
            send_message,
            pick_chat_attachment
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
