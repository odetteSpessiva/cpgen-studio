use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::{fs, io::AsyncWriteExt, process::Command, time::timeout};

pub fn clean_path(path: &Path) -> Result<String, String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| "Unable to parse path".to_string())?;
    Ok(path_str
        .strip_prefix(r"\\?\")
        .unwrap_or(path_str)
        .to_string())
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn new_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub async fn prep_executable(
    source: &Path,
    gpp_path: &str,
    compiler_args: &str,
    python_path: &str,
) -> Result<(String, Vec<String>), String> {
    match source.extension().and_then(|s| s.to_str()) {
        Some("py") => {
            let default_python = if cfg!(target_os = "windows") {
                "python"
            } else {
                "python3"
            };
            let python = if python_path.trim().is_empty() {
                default_python
            } else {
                python_path
            };
            Ok((python.to_string(), vec![clean_path(source)?]))
        }
        Some("cpp") => {
            let parent = source
                .parent()
                .ok_or_else(|| "Failed to get source directory".to_string())?;

            let build_dir = parent.join("build");
            fs::create_dir_all(&build_dir)
                .await
                .map_err(|e| format!("Failed to create build subdirectory: {e}"))?;

            let file_stem = source
                .file_stem()
                .ok_or_else(|| "Failed to get file stem".to_string())?;

            let exe = build_dir.join(file_stem).with_extension("exe");

            let compiler = if gpp_path.trim().is_empty() {
                "g++"
            } else {
                gpp_path
            };

            let flags = shell_words::split(compiler_args).map_err(|e| e.to_string())?;

            let mut cmd = {
                #[cfg(target_os = "windows")]
                {
                    new_command(compiler)
                }
                #[cfg(not(target_os = "windows"))]
                {
                    Command::new(compiler)
                }
            };

            let output = cmd
                .args(&flags)
                .args([
                    clean_path(source)?.as_str(),
                    "-o",
                    clean_path(&exe)?.as_str(),
                ])
                .output()
                .await
                .map_err(|e| format!("Failed to execute g++ compiler: {e}"))?;

            if output.status.success() {
                Ok((clean_path(&exe)?, vec![]))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Compilation failed:\n{stderr}"))
            }
        }
        Some(other) => Err(format!("Unknown extension: {other}")),
        None => Err("Unable to find file extension".to_string()),
    }
}

pub async fn run(
    command: &(String, Vec<String>),
    timeout_duration: Duration,
    stdin: Option<&str>,
) -> Result<String, String> {
    let (program, args) = command;

    let mut cmd = {
        #[cfg(target_os = "windows")]
        {
            new_command(program)
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new(program)
        }
    };

    let mut child = cmd
        .args(args)
        .kill_on_drop(true)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start process: {e}"))?;

    if let Some(input) = stdin {
        if let Some(mut child_stdin) = child.stdin.take() {
            let input = input.to_string();
            tauri::async_runtime::spawn(async move {
                let _ = child_stdin.write_all(input.as_bytes()).await;
            });
        }
    }

    let output = match timeout(timeout_duration, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("Failed waiting for child process: {e}")),
        Err(_) => {
            return Err("Time Limit Exceeded".to_string());
        }
    };

    if !output.status.success() {
        let stderr_string = String::from_utf8(output.stderr)
            .map_err(|e| format!("Unable to convert output into string: {e}"))?;
        return Err(format!(
            "Runtime Error (Exit code {})\nStderr:\n{}",
            output.status.code().unwrap_or(-69),
            stderr_string
        ));
    }

    let stdout_string =
        String::from_utf8(output.stdout).map_err(|e| format!("Invalid stdout: {e}"))?;

    Ok(stdout_string.trim().to_string())
}
