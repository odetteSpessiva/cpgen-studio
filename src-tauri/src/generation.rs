use crate::runner::prep_executable;
use crate::{runner, schema, validate};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tauri_plugin_store::StoreExt;
use tokio::fs;

#[derive(Serialize, Clone)]
struct StatusPayload {
    step: String,
    message: String,
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

async fn run_optional(
    cmd: &Option<(String, Vec<String>)>,
    timeout: Duration,
    input: Option<&str>,
) -> Result<Option<String>, String> {
    match cmd {
        Some(cmd) => Ok(Some(runner::run(cmd, timeout, input).await?)),
        None => Ok(None),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenConfig {
    sol_path: Option<PathBuf>,
    output_path: PathBuf,
    test_name: String,
    test_count: i32,
    start_id: i32,
}

async fn compiler_settings(app: &AppHandle) -> Result<(String, String, String), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    let get = |key| {
        store
            .get(key)
            .and_then(|value| value.as_str().map(String::from))
            .unwrap_or_default()
    };
    Ok((get("gppPath"), get("compilerArgs"), get("pythonPath")))
}

async fn write_test(
    output_path: &Path,
    test_name: &str,
    id: i32,
    input: &str,
    output: Option<String>,
) -> Result<(), String> {
    let test_path = output_path.join(format!("{test_name}{id}"));
    fs::create_dir_all(&test_path)
        .await
        .map_err(|e| format!("Unable to create test output directory: {e}"))?;
    fs::write(test_path.join(format!("{test_name}.inp")), input)
        .await
        .map_err(|e| format!("Unable to write test: {e}"))?;
    if let Some(output) = output {
        fs::write(test_path.join(format!("{test_name}.out")), output)
            .await
            .map_err(|e| format!("Unable to write result: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn generate_tests(
    app: AppHandle,
    gen_path: PathBuf,
    config: GenConfig,
    index_as_arg: bool,
) -> Result<(), String> {
    const BATCH_SIZE: usize = 4;
    send_status(
        &app,
        "prep_executable",
        "Preparing run command for provided files",
    );
    let (gpp_path, compiler_args, python_path) = compiler_settings(&app).await?;
    let gen_command = prep_executable(&gen_path, &gpp_path, &compiler_args, &python_path).await?;
    let sol_command = match config.sol_path {
        Some(path) => Some(prep_executable(&path, &gpp_path, &compiler_args, &python_path).await?),
        None => None,
    };
    let mut in_flight = tokio::task::JoinSet::new();
    for i in 0..config.test_count {
        let gen_command = gen_command.clone();
        let sol_command = sol_command.clone();
        let output_path = config.output_path.clone();
        let test_name = config.test_name.clone();
        let app = app.clone();
        in_flight.spawn(async move {
            let id = i + config.start_id;
            let index = id.to_string();
            send_status(
                &app,
                "run_executable",
                format!("Generating test #{id}").as_str(),
            );
            let test = if index_as_arg {
                let mut command = gen_command.clone();
                command.1.push(index);
                runner::run(&command, Duration::from_secs(10), None).await?
            } else {
                runner::run(&gen_command, Duration::from_secs(10), Some(&index)).await?
            };
            let result = run_optional(&sol_command, Duration::from_secs(10), Some(&test)).await?;
            write_test(&output_path, &test_name, id, &test, result).await
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
        format!("Finished generating {} tests.", config.test_count).as_str(),
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn generate_tests_from_schema(
    app: AppHandle,
    schema: Vec<schema::SchemaNode>,
    config: GenConfig,
    seed: Option<u64>,
) -> Result<(), String> {
    validate::validate(&schema).map_err(|errors| {
        errors
            .iter()
            .map(|error| error.to_string())
            .collect::<Vec<_>>()
            .join("\n")
    })?;
    const BATCH_SIZE: usize = 4;
    send_status(
        &app,
        "prep_executable",
        "Preparing run command for solution file",
    );
    let (gpp_path, compiler_args, python_path) = compiler_settings(&app).await?;
    let sol_command = match config.sol_path {
        Some(path) => Some(prep_executable(&path, &gpp_path, &compiler_args, &python_path).await?),
        None => None,
    };
    let mut in_flight = tokio::task::JoinSet::new();
    for i in 0..config.test_count {
        let schema = schema.clone();
        let sol_command = sol_command.clone();
        let output_path = config.output_path.clone();
        let test_name = config.test_name.clone();
        let app = app.clone();
        in_flight.spawn(async move {
            let id = i + config.start_id;
            send_status(
                &app,
                "generate_input",
                format!("Generating test #{id} from schema").as_str(),
            );
            let test = schema::generate(&schema, seed.map(|value| value.wrapping_add(i as u64)))
                .map_err(|e| format!("Schema interpretation failed: {e}"))?;
            let result = run_optional(&sol_command, Duration::from_secs(10), Some(&test)).await?;
            write_test(&output_path, &test_name, id, &test, result).await
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
        format!("Finished generating {} tests.", config.test_count).as_str(),
    );
    Ok(())
}

#[tauri::command(async)]
pub(crate) fn preview_schema(
    schema: Vec<schema::SchemaNode>,
    seed: Option<u64>,
) -> Result<String, String> {
    schema::generate(&schema, seed)
}

#[cfg(test)]
mod tests {
    use super::preview_schema;
    use crate::schema::{Charset, SchemaNode};

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

        let result = preview_schema(schema, Some(7)).unwrap();
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

        let result = preview_schema(schema, Some(1));
        assert!(matches!(result, Err(error) if error.contains("greater than max")));
    }
}
