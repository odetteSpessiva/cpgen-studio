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
