use crate::schema::{Charset, PrimitiveSpec, SchemaNode};

pub struct ValidationError {
    pub path: String,
    pub message: String,
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.path, self.message)
    }
}

pub fn validate(nodes: &[SchemaNode]) -> Result<(), Vec<ValidationError>> {
    let mut errors = Vec::new();
    validate_nodes(nodes, "root", &mut errors);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn validate_nodes(nodes: &[SchemaNode], path: &str, errors: &mut Vec<ValidationError>) {
    for (i, node) in nodes.iter().enumerate() {
        validate_node(node, &format!("{path}[{i}]"), errors);
    }
}

fn validate_node(node: &SchemaNode, path: &str, errors: &mut Vec<ValidationError>) {
    match node {
        SchemaNode::Int {
            var_name,
            output_format,
            ..
        }
        | SchemaNode::Float {
            var_name,
            output_format,
            ..
        } => {
            validate_output_format(var_name, output_format, path, errors);
        }
        SchemaNode::String {
            charset,
            custom_charset,
            ..
        } => {
            validate_charset(charset, custom_charset, path, errors);
        }
        SchemaNode::Array { element, .. } => {
            validate_primitive_spec(element, &format!("{path}.element"), errors);
        }
        SchemaNode::Loop { children, .. } => {
            validate_nodes(children, path, errors);
        }
        SchemaNode::If {
            if_children,
            else_children,
            ..
        } => {
            validate_nodes(if_children, &format!("{path}.ifChildren"), errors);
            validate_nodes(else_children, &format!("{path}.elseChildren"), errors);
        }
    }
}

fn validate_output_format(
    var_name: &Option<String>,
    output_format: &Option<String>,
    path: &str,
    errors: &mut Vec<ValidationError>,
) {
    if output_format.is_some() {
        let has_var_name = var_name.as_ref().is_some_and(|n| !n.is_empty());
        if !has_var_name {
            errors.push(ValidationError {
                path: path.to_string(),
                message: "outputFormat is set but varName is empty".to_string(),
            });
        }
    }
}

fn validate_charset(
    charset: &Charset,
    custom_charset: &Option<String>,
    path: &str,
    errors: &mut Vec<ValidationError>,
) {
    if matches!(charset, Charset::Custom) {
        let empty = custom_charset.as_ref().is_none_or(|s| s.is_empty());
        if empty {
            errors.push(ValidationError {
                path: path.to_string(),
                message: "charset is Custom but customCharset is empty".to_string(),
            });
        }
    }
}

fn validate_primitive_spec(spec: &PrimitiveSpec, path: &str, errors: &mut Vec<ValidationError>) {
    if let PrimitiveSpec::String {
        charset,
        custom_charset,
        ..
    } = spec
    {
        validate_charset(charset, custom_charset, path, errors);
    }
}

#[cfg(test)]
mod tests {
    use super::validate;
    use crate::schema::{Charset, SchemaNode};

    #[test]
    fn accepts_valid_output_format_and_custom_charset() {
        let nodes = vec![
            SchemaNode::Int {
                var_name: Some("n".to_string()),
                min: "1".to_string(),
                max: "10".to_string(),
                output_format: Some("n={n}".to_string()),
            },
            SchemaNode::String {
                var_name: None,
                length: "3".to_string(),
                charset: Charset::Custom,
                custom_charset: Some("abc".to_string()),
            },
        ];

        assert!(validate(&nodes).is_ok());
    }

    #[test]
    fn reports_output_format_without_variable_name() {
        let nodes = vec![SchemaNode::Float {
            var_name: Some(String::new()),
            min: "0".to_string(),
            max: "1".to_string(),
            output_format: Some("{value}".to_string()),
        }];

        let errors = validate(&nodes).unwrap_err();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].path, "root[0]");
        assert!(errors[0].message.contains("varName is empty"));
    }

    #[test]
    fn reports_nested_custom_charset_error_with_full_path() {
        let nodes = vec![SchemaNode::Loop {
            count: "T".to_string(),
            children: vec![SchemaNode::String {
                var_name: None,
                length: "3".to_string(),
                charset: Charset::Custom,
                custom_charset: None,
            }],
        }];

        let errors = validate(&nodes).unwrap_err();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].path, "root[0][0]");
        assert!(errors[0].message.contains("customCharset is empty"));
    }

    #[test]
    fn reports_errors_in_if_and_else_branches_with_distinct_paths() {
        let nodes = vec![SchemaNode::If {
            condition: "true".to_string(),
            if_children: vec![SchemaNode::Float {
                var_name: None,
                min: "0".to_string(),
                max: "1".to_string(),
                output_format: Some("{value}".to_string()),
            }],
            else_children: vec![SchemaNode::String {
                var_name: None,
                length: "1".to_string(),
                charset: Charset::Custom,
                custom_charset: None,
            }],
        }];

        let errors = validate(&nodes).unwrap_err();

        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].path, "root[0].ifChildren[0]");
        assert_eq!(errors[1].path, "root[0].elseChildren[0]");
    }
}
