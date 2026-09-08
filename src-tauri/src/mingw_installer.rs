use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::time::Instant;
use std::{
    fs::File,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
#[cfg(target_os = "windows")]
use tokio::process::Command;
use zip::ZipArchive;

const MINGW_URL: &str =
    "https://github.com/brechtsanders/winlibs_mingw/releases/download/16.2.0posix-14.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-16.2.0-mingw-w64ucrt-14.0.0-r1.zip";

const MINGW_SHA256: &str = "c1f52294597c0b73786b2a78eb5d176d89226d2f21875eab75e783a8b1cefcc4";

#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    elapsed_ms: u64,
}

pub struct DownloadState(pub AtomicBool);

pub async fn download_to(
    app: &AppHandle,
    dest: &Path,
    state: &DownloadState,
) -> Result<(), String> {
    let response = reqwest::get(MINGW_URL)
        .await
        .map_err(|e| format!("Failed to download: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }
    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Failed to create file: {e}"))?;
    let mut stream = response.bytes_stream();
    let start = Instant::now();
    let mut last_emit = Instant::now();
    let emit_interval = std::time::Duration::from_millis(200);
    while let Some(chunk) = stream.next().await {
        if state.0.load(Ordering::Relaxed) {
            return Err("Download canceled".to_string());
        }
        let chunk = chunk.map_err(|e| format!("Failed to download: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        downloaded += chunk.len() as u64;
        let now = Instant::now();
        if now.duration_since(last_emit) >= emit_interval {
            let _ = app.emit(
                "mingw-install-progress",
                DownloadProgress {
                    downloaded,
                    total,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                },
            );
            last_emit = Instant::now();
        }
    }
    let _ = app.emit(
        "mingw-install-progress",
        DownloadProgress {
            downloaded,
            total,
            elapsed_ms: start.elapsed().as_millis() as u64,
        },
    );
    file.flush()
        .await
        .map_err(|e| format!("Flush error: {e}"))?;
    Ok(())
}

async fn sha256_of(path: &Path) -> Result<String, String> {
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("Failed to read downloaded file: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(hex::encode(hasher.finalize()))
}

fn extract_mingw_archive(archive_path: &Path, install_dir: &Path) -> Result<String, String> {
    let archive =
        File::open(archive_path).map_err(|e| format!("Failed to open verified archive: {e}"))?;
    let mut archive =
        ZipArchive::new(archive).map_err(|e| format!("Failed to read verified archive: {e}"))?;
    let mut compiler_path = None;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("Failed to read archive entry: {e}"))?;
        let relative_path = entry
            .enclosed_name()
            .ok_or_else(|| "Archive contains an unsafe path".to_string())?
            .to_path_buf();
        let output_path = install_dir.join(&relative_path);

        if entry.is_dir() {
            std::fs::create_dir_all(&output_path)
                .map_err(|e| format!("Failed to create compiler directory: {e}"))?;
        } else {
            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create compiler directory: {e}"))?;
            }
            let mut output = File::create(&output_path)
                .map_err(|e| format!("Failed to extract compiler file: {e}"))?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|e| format!("Failed to extract compiler file: {e}"))?;

            if relative_path
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("g++.exe") || name == "g++")
                && relative_path
                    .parent()
                    .is_some_and(|parent| parent.ends_with("bin"))
            {
                compiler_path = Some(output_path);
            }
        }
    }

    let compiler_path = compiler_path
        .ok_or_else(|| "The downloaded archive does not contain a g++ executable".to_string())?;
    Ok(compiler_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn download_mingw(
    app: AppHandle,
    state: tauri::State<'_, DownloadState>,
) -> Result<String, String> {
    state.0.store(false, Ordering::Relaxed);
    let tmp_path = std::env::temp_dir().join("cpgen-mingw-download.zip");
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let final_path = app_dir.join("mingw-download.zip");
    if let Err(error) = download_to(&app, &tmp_path, &state).await {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(error);
    }
    let hash = sha256_of(&tmp_path).await?;
    if !hash.eq_ignore_ascii_case(MINGW_SHA256) {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(format!(
            "Checksum mismatch: expected {MINGW_SHA256}, got {hash}"
        ));
    }
    tokio::fs::create_dir_all(&app_dir)
        .await
        .map_err(|e| format!("Failed to create install dir: {e}"))?;

    tokio::fs::rename(&tmp_path, &final_path)
        .await
        .map_err(|e| format!("Failed to move verified archive: {e}"))?;
    let install_dir = app_dir.join("mingw");
    let archive_path = final_path.clone();
    let result =
        tokio::task::spawn_blocking(move || extract_mingw_archive(&archive_path, &install_dir))
            .await
            .map_err(|e| format!("Failed to extract compiler archive: {e}"))?;
    state.0.store(false, Ordering::Relaxed);
    let compiler_path = result?;
    tokio::fs::remove_file(&final_path)
        .await
        .map_err(|e| format!("Failed to remove extracted archive: {e}"))?;
    Ok(compiler_path)
}

#[tauri::command]
pub fn cancel_mingw(state: tauri::State<'_, DownloadState>) {
    state.0.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub async fn check_compiler(compiler_path: String) -> bool {
    #[cfg(not(target_os = "windows"))]
    {
        // MinGW installation is currently Windows-only; treat the system compiler as valid elsewhere.
        let _ = compiler_path;
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        let compiler = if compiler_path.trim().is_empty() {
            "g++"
        } else {
            compiler_path.trim()
        };

        let output = match Command::new(compiler).arg("--version").output().await {
            Ok(output) if output.status.success() => output,
            _ => return false,
        };
        let version = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
        .to_ascii_lowercase();
        version.contains("g++") || version.contains("gcc")
    }
}
