use crate::expr;
use crate::format as numeric_formatter;
use rand::{rngs::StdRng, Rng, RngExt, SeedableRng};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Charset {
    Lowercase,
    Uppercase,
    Alphanumeric,
    Digits,
    Custom,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Separator {
    Space,
    Newline,
    Comma,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PrimitiveSpec {
    Int {
        min: String,
        max: String,
    },
    Float {
        min: String,
        max: String,
    },
    String {
        length: String,
        charset: Charset,
        #[serde(rename = "customCharset")]
        custom_charset: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SchemaNode {
    Int {
        #[serde(rename = "varName")]
        var_name: Option<String>,
        min: String,
        max: String,
        #[serde(rename = "outputFormat")]
        output_format: Option<String>,
    },
    Float {
        #[serde(rename = "varName")]
        var_name: Option<String>,
        min: String,
        max: String,
        #[serde(rename = "outputFormat")]
        output_format: Option<String>,
    },
    String {
        #[serde(rename = "varName")]
        var_name: Option<String>,
        length: String,
        charset: Charset,
        #[serde(rename = "customCharset")]
        custom_charset: Option<String>,
    },
    Array {
        #[serde(rename = "varName")]
        var_name: Option<String>,
        length: String,
        separator: Separator,
        element: PrimitiveSpec,
    },
    Loop {
        count: String,
        children: Vec<SchemaNode>,
    },
}

enum Value {
    Num(f64),
    Text,
}

struct Interpreter {
    rng: Box<dyn Rng>,
    vars: HashMap<String, Value>,
}

impl Interpreter {
    fn numeric_env(&self) -> HashMap<String, f64> {
        self.vars
            .iter()
            .filter_map(|(k, v)| match v {
                Value::Num(n) => Some((k.clone(), *n)),
                _ => None,
            })
            .collect()
    }

    fn resolve_number(&self, field: &str, raw: &str) -> Result<f64, String> {
        let tokens = expr::tokenize(raw).map_err(|e| format!("{field}: {e}"))?;
        let ast = expr::Parser::new(tokens)
            .parse()
            .map_err(|e: String| format!("{field}: {e}"))?;
        let value = ast
            .eval(&self.numeric_env())
            .map_err(|e| format!("{field}: {e}"))?;
        if !value.is_finite() {
            return Err(format!(
                "{field}: expression '{raw}' produced a non-finite result"
            ));
        }
        Ok(value)
    }

    fn resolve_int(&self, field: &str, raw: &str) -> Result<i64, String> {
        Ok(self.resolve_number(field, raw)?.round() as i64)
    }

    fn bind(&mut self, var_name: &Option<String>, value: Value) {
        if let Some(name) = var_name {
            if !name.is_empty() {
                self.vars.insert(name.clone(), value);
            }
        }
    }
}

impl Interpreter {
    fn gen_int(&mut self, min: &str, max: &str) -> Result<i64, String> {
        let lo = self.resolve_int("min", min)?;
        let hi = self.resolve_int("max", max)?;
        if lo > hi {
            return Err(format!("min ({lo}) is greater than max ({hi})"));
        }
        Ok(self.rng.random_range(lo..=hi))
    }

    fn gen_float(&mut self, min: &str, max: &str) -> Result<f64, String> {
        let lo = self.resolve_number("min", min)?;
        let hi = self.resolve_number("max", max)?;
        if lo > hi {
            return Err(format!("min ({lo}) is greater than max ({hi})"));
        }
        let v = self.rng.random_range(lo..=hi);
        Ok(v)
    }

    fn gen_string(
        &mut self,
        length: &str,
        charset: &Charset,
        custom: &Option<String>,
    ) -> Result<String, String> {
        let len = self.resolve_int("length", length)?;
        if len < 0 {
            return Err(format!("length ({len}) cannot be negative"));
        }
        let alphabet: Vec<char> = match charset {
            Charset::Lowercase => ('a'..='z').collect(),
            Charset::Uppercase => ('A'..='Z').collect(),
            Charset::Alphanumeric => ('a'..='z').chain('A'..='Z').chain('0'..='9').collect(),
            Charset::Digits => ('0'..='9').collect(),
            Charset::Custom => custom.clone().unwrap_or_default().chars().collect(),
        };
        if alphabet.is_empty() {
            return Err("charset resolved to an empty character set".to_string());
        }
        Ok((0..len)
            .map(|_| alphabet[self.rng.random_range(0..alphabet.len())])
            .collect())
    }

    fn gen_primitive(&mut self, spec: &PrimitiveSpec) -> Result<String, String> {
        match spec {
            PrimitiveSpec::Int { min, max } => Ok(self.gen_int(min, max)?.to_string()),
            PrimitiveSpec::Float { min, max } => {
                self.gen_float(min, max).map(|res| format!("{res:.2}"))
            }
            PrimitiveSpec::String {
                length,
                charset,
                custom_charset,
            } => self.gen_string(length, charset, custom_charset),
        }
    }
}

impl Interpreter {
    fn eval_nodes(&mut self, nodes: &[SchemaNode], out: &mut Vec<String>) -> Result<(), String> {
        for node in nodes {
            match node {
                SchemaNode::Int {
                    var_name,
                    min,
                    max,
                    output_format,
                    ..
                } => {
                    let v = self.gen_int(min, max)?;
                    self.bind(var_name, Value::Num(v as f64));
                    if let Some(input) = output_format {
                        let segments = numeric_formatter::parse_string(input)?;
                        out.push(numeric_formatter::render_string(
                            segments,
                            &self.numeric_env(),
                        )?);
                    } else {
                        out.push(v.to_string() + "\n")
                    };
                }
                SchemaNode::Float {
                    var_name,
                    min,
                    max,
                    output_format,
                    ..
                } => {
                    let v = self.gen_float(min, max)?;
                    self.bind(var_name, Value::Num(v));
                    if let Some(input) = output_format {
                        let segments = numeric_formatter::parse_string(input)?;
                        out.push(numeric_formatter::render_string(
                            segments,
                            &self.numeric_env(),
                        )?);
                    } else {
                        out.push(format!("{v:.2}") + "\n")
                    };
                }
                SchemaNode::String {
                    var_name,
                    length,
                    charset,
                    custom_charset,
                    ..
                } => {
                    let s = self.gen_string(length, charset, custom_charset)?;
                    self.bind(var_name, Value::Text);
                    out.push(s + "\n");
                }
                SchemaNode::Array {
                    var_name,
                    length,
                    separator,
                    element,
                    ..
                } => {
                    let n = self.resolve_int("length", length)?;
                    if n < 0 {
                        return Err(format!("array length ({n}) cannot be negative"));
                    }
                    let sep = match separator {
                        Separator::Space => " ",
                        Separator::Newline => "\n",
                        Separator::Comma => ",",
                    };
                    let mut items = Vec::with_capacity(n as usize);
                    for _ in 0..n {
                        items.push(self.gen_primitive(element)?);
                    }
                    let line = items.join(sep);
                    self.bind(var_name, Value::Text);
                    out.push(line + "\n");
                }
                SchemaNode::Loop {
                    count, children, ..
                } => {
                    let reps = self.resolve_int("count", count)?;
                    if reps < 0 {
                        return Err(format!("loop count ({reps}) cannot be negative"));
                    }
                    for _ in 0..reps {
                        self.eval_nodes(children, out)?;
                    }
                }
            }
        }
        Ok(())
    }
}

pub fn generate(nodes: &[SchemaNode], seed: Option<u64>) -> Result<String, String> {
    let rng: Box<dyn Rng> = match seed {
        Some(s) => Box::new(StdRng::seed_from_u64(s)),
        None => Box::new(rand::rng()),
    };
    let mut interp = Interpreter {
        rng,
        vars: HashMap::new(),
    };
    let mut lines = Vec::new();
    interp.eval_nodes(nodes, &mut lines)?;
    Ok(lines.join(""))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_interp(seed: u64) -> Interpreter {
        Interpreter {
            rng: Box::new(StdRng::seed_from_u64(seed)),
            vars: HashMap::new(),
        }
    }

    // resolve_number / resolve_int

    #[test]
    fn resolve_number_valid_literal() {
        let interp = make_interp(1);
        assert_eq!(interp.resolve_number("field", "5").unwrap(), 5.0);
    }

    #[test]
    fn resolve_number_tokenize_error() {
        let interp = make_interp(1);
        let err = interp.resolve_number("field", "@@@").unwrap_err();
        assert!(err.contains("field"));
    }

    #[test]
    fn resolve_number_parse_error() {
        let interp = make_interp(1);
        let err = interp.resolve_number("field", "(1+").unwrap_err();
        assert!(err.contains("field"));
    }

    #[test]
    fn resolve_number_eval_unknown_variable_error() {
        let interp = make_interp(1);
        let err = interp.resolve_number("field", "unknown_var").unwrap_err();
        assert!(err.contains("field"));
    }

    #[test]
    fn resolve_number_non_finite_errors() {
        let interp = make_interp(1);
        let err = interp.resolve_number("field", "1/0").unwrap_err();
        assert!(err.contains("non-finite"));
    }

    #[test]
    fn resolve_int_rounds_to_nearest() {
        let interp = make_interp(1);
        assert_eq!(interp.resolve_int("field", "2.6").unwrap(), 3);
        assert_eq!(interp.resolve_int("field", "2.4").unwrap(), 2);
    }

    // numeric_env / bind

    #[test]
    fn numeric_env_filters_out_text_values() {
        let mut interp = make_interp(1);
        interp.vars.insert("n".to_string(), Value::Num(4.0));
        interp.vars.insert("s".to_string(), Value::Text);
        let env = interp.numeric_env();
        assert_eq!(env.get("n"), Some(&4.0));
        assert!(!env.contains_key("s"));
    }

    #[test]
    fn bind_with_named_var_inserts() {
        let mut interp = make_interp(1);
        interp.bind(&Some("x".to_string()), Value::Num(7.0));
        assert!(matches!(interp.vars.get("x"), Some(Value::Num(v)) if *v == 7.0));
    }

    #[test]
    fn bind_with_empty_name_does_not_insert() {
        let mut interp = make_interp(1);
        interp.bind(&Some("".to_string()), Value::Num(7.0));
        assert!(interp.vars.is_empty());
    }

    #[test]
    fn bind_with_none_does_not_insert() {
        let mut interp = make_interp(1);
        interp.bind(&None, Value::Num(7.0));
        assert!(interp.vars.is_empty());
    }

    // gen_int

    #[test]
    fn gen_int_within_range() {
        let mut interp = make_interp(1);
        for _ in 0..20 {
            let v = interp.gen_int("1", "5").unwrap();
            assert!((1..=5).contains(&v));
        }
    }

    #[test]
    fn gen_int_min_equals_max() {
        let mut interp = make_interp(1);
        assert_eq!(interp.gen_int("3", "3").unwrap(), 3);
    }

    #[test]
    fn gen_int_min_greater_than_max_errors() {
        let mut interp = make_interp(1);
        let err = interp.gen_int("5", "1").unwrap_err();
        assert!(err.contains("greater than max"));
    }

    // gen_string

    #[test]
    fn gen_string_lowercase() {
        let mut interp = make_interp(1);
        let s = interp.gen_string("10", &Charset::Lowercase, &None).unwrap();
        assert_eq!(s.len(), 10);
        assert!(s.chars().all(|c| c.is_ascii_lowercase()));
    }

    #[test]
    fn gen_string_uppercase() {
        let mut interp = make_interp(1);
        let s = interp.gen_string("10", &Charset::Uppercase, &None).unwrap();
        assert_eq!(s.len(), 10);
        assert!(s.chars().all(|c| c.is_ascii_uppercase()));
    }

    #[test]
    fn gen_string_alphanumeric() {
        let mut interp = make_interp(1);
        let s = interp
            .gen_string("20", &Charset::Alphanumeric, &None)
            .unwrap();
        assert_eq!(s.len(), 20);
        assert!(s.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn gen_string_digits() {
        let mut interp = make_interp(1);
        let s = interp.gen_string("10", &Charset::Digits, &None).unwrap();
        assert_eq!(s.len(), 10);
        assert!(s.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn gen_string_custom() {
        let mut interp = make_interp(1);
        let custom = Some("xyz".to_string());
        let s = interp.gen_string("10", &Charset::Custom, &custom).unwrap();
        assert_eq!(s.len(), 10);
        assert!(s.chars().all(|c| "xyz".contains(c)));
    }

    #[test]
    fn gen_string_custom_none_errors_empty_alphabet() {
        let mut interp = make_interp(1);
        let err = interp
            .gen_string("10", &Charset::Custom, &None)
            .unwrap_err();
        assert!(err.contains("empty character set"));
    }

    #[test]
    fn gen_string_custom_empty_string_errors() {
        let mut interp = make_interp(1);
        let custom = Some("".to_string());
        let err = interp
            .gen_string("10", &Charset::Custom, &custom)
            .unwrap_err();
        assert!(err.contains("empty character set"));
    }

    #[test]
    fn gen_string_negative_length_errors() {
        let mut interp = make_interp(1);
        let err = interp
            .gen_string("-1", &Charset::Lowercase, &None)
            .unwrap_err();
        assert!(err.contains("cannot be negative"));
    }

    #[test]
    fn gen_string_zero_length() {
        let mut interp = make_interp(1);
        let s = interp.gen_string("0", &Charset::Lowercase, &None).unwrap();
        assert_eq!(s, "");
    }

    // gen_primitive

    #[test]
    fn gen_primitive_int_variant() {
        let mut interp = make_interp(1);
        let spec = PrimitiveSpec::Int {
            min: "5".to_string(),
            max: "5".to_string(),
        };
        assert_eq!(interp.gen_primitive(&spec).unwrap(), "5");
    }

    #[test]
    fn gen_primitive_float_variant() {
        let mut interp = make_interp(1);
        let spec = PrimitiveSpec::Float {
            min: "1".to_string(),
            max: "1".to_string(),
        };
        assert_eq!(interp.gen_primitive(&spec).unwrap(), "1.00");
    }

    #[test]
    fn gen_primitive_string_variant() {
        let mut interp = make_interp(1);
        let spec = PrimitiveSpec::String {
            length: "3".to_string(),
            charset: Charset::Digits,
            custom_charset: None,
        };
        let s = interp.gen_primitive(&spec).unwrap();
        assert_eq!(s.len(), 3);
        assert!(s.chars().all(|c| c.is_ascii_digit()));
    }

    // eval_nodes: Int

    #[test]
    fn eval_nodes_int_binds_var_and_outputs() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Int {
            var_name: Some("n".to_string()),
            min: "4".to_string(),
            max: "4".to_string(),
            output_format: None,
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert_eq!(out, vec!["4\n".to_string()]);
        assert!(matches!(interp.vars.get("n"), Some(Value::Num(v)) if *v == 4.0));
    }

    // eval_nodes: Float

    #[test]
    fn eval_nodes_float_binds_var_and_outputs() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Float {
            var_name: Some("f".to_string()),
            min: "2.5".to_string(),
            max: "2.5".to_string(),
            output_format: None,
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert_eq!(out, vec!["2.50\n".to_string()]);
        assert!(matches!(interp.vars.get("f"), Some(Value::Num(v)) if (*v - 2.5).abs() < 1e-9));
    }

    // eval_nodes: String

    #[test]
    fn eval_nodes_string_binds_var_as_text() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::String {
            var_name: Some("s".to_string()),
            length: "5".to_string(),
            charset: Charset::Lowercase,
            custom_charset: None,
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert_eq!(out[0].len(), 6);
        assert!(matches!(interp.vars.get("s"), Some(Value::Text)));
    }

    // eval_nodes: Array

    #[test]
    fn eval_nodes_array_space_separator() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Array {
            var_name: None,
            length: "3".to_string(),
            separator: Separator::Space,
            element: PrimitiveSpec::Int {
                min: "1".to_string(),
                max: "1".to_string(),
            },
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert_eq!(out, vec!["1 1 1\n".to_string()]);
    }

    #[test]
    fn eval_nodes_array_newline_separator() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Array {
            var_name: None,
            length: "2".to_string(),
            separator: Separator::Newline,
            element: PrimitiveSpec::Int {
                min: "2".to_string(),
                max: "2".to_string(),
            },
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert_eq!(out, vec!["2\n2\n".to_string()]);
    }

    #[test]
    fn eval_nodes_array_comma_separator() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Array {
            var_name: None,
            length: "2".to_string(),
            separator: Separator::Comma,
            element: PrimitiveSpec::Int {
                min: "3".to_string(),
                max: "3".to_string(),
            },
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert_eq!(out, vec!["3,3\n".to_string()]);
    }

    #[test]
    fn eval_nodes_array_binds_var_as_text() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Array {
            var_name: Some("arr".to_string()),
            length: "2".to_string(),
            separator: Separator::Comma,
            element: PrimitiveSpec::Int {
                min: "1".to_string(),
                max: "1".to_string(),
            },
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert!(matches!(interp.vars.get("arr"), Some(Value::Text)));
    }

    #[test]
    fn eval_nodes_array_negative_length_errors() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Array {
            var_name: None,
            length: "-1".to_string(),
            separator: Separator::Space,
            element: PrimitiveSpec::Int {
                min: "1".to_string(),
                max: "1".to_string(),
            },
        }];
        let mut out = Vec::new();
        let err = interp.eval_nodes(&nodes, &mut out).unwrap_err();
        assert!(err.contains("cannot be negative"));
    }

    #[test]
    fn eval_nodes_array_zero_length_produces_empty_line() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Array {
            var_name: None,
            length: "0".to_string(),
            separator: Separator::Space,
            element: PrimitiveSpec::Int {
                min: "1".to_string(),
                max: "1".to_string(),
            },
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert_eq!(out, vec!["\n".to_string()]);
    }

    // eval_nodes: Loop

    #[test]
    fn eval_nodes_loop_repeats_children() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Loop {
            count: "3".to_string(),
            children: vec![SchemaNode::Int {
                var_name: None,
                min: "9".to_string(),
                max: "9".to_string(),
                output_format: None,
            }],
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert_eq!(
            out,
            vec!["9\n".to_string(), "9\n".to_string(), "9\n".to_string()]
        );
    }

    #[test]
    fn eval_nodes_loop_zero_reps_produces_nothing() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Loop {
            count: "0".to_string(),
            children: vec![SchemaNode::Int {
                var_name: None,
                min: "9".to_string(),
                max: "9".to_string(),
                output_format: None,
            }],
        }];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn eval_nodes_loop_negative_count_errors() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Loop {
            count: "-2".to_string(),
            children: vec![],
        }];
        let mut out = Vec::new();
        let err = interp.eval_nodes(&nodes, &mut out).unwrap_err();
        assert!(err.contains("cannot be negative"));
    }

    #[test]
    fn eval_nodes_loop_propagates_child_error() {
        let mut interp = make_interp(1);
        let nodes = vec![SchemaNode::Loop {
            count: "2".to_string(),
            children: vec![SchemaNode::Int {
                var_name: None,
                min: "5".to_string(),
                max: "1".to_string(),
                output_format: None,
            }],
        }];
        let mut out = Vec::new();
        let err = interp.eval_nodes(&nodes, &mut out).unwrap_err();
        assert!(err.contains("greater than max"));
    }

    // cross-node variable interaction

    #[test]
    fn eval_nodes_var_bound_by_int_used_by_later_node() {
        let mut interp = make_interp(1);
        let nodes = vec![
            SchemaNode::Int {
                var_name: Some("n".to_string()),
                min: "5".to_string(),
                max: "5".to_string(),
                output_format: None,
            },
            SchemaNode::Array {
                var_name: None,
                length: "n".to_string(),
                separator: Separator::Space,
                element: PrimitiveSpec::Int {
                    min: "1".to_string(),
                    max: "1".to_string(),
                },
            },
        ];
        let mut out = Vec::new();
        interp.eval_nodes(&nodes, &mut out).unwrap();
        assert_eq!(out[1], "1 1 1 1 1\n");
    }

    #[test]
    fn eval_nodes_text_var_not_usable_numerically() {
        let mut interp = make_interp(1);
        let nodes = vec![
            SchemaNode::String {
                var_name: Some("s".to_string()),
                length: "3".to_string(),
                charset: Charset::Lowercase,
                custom_charset: None,
            },
            SchemaNode::Int {
                var_name: None,
                min: "s".to_string(),
                max: "s".to_string(),
                output_format: None,
            },
        ];
        let mut out = Vec::new();
        let err = interp.eval_nodes(&nodes, &mut out).unwrap_err();
        assert!(err.contains("min"));
    }

    // generate()

    #[test]
    fn generate_joins_lines_with_newline() {
        let nodes = vec![
            SchemaNode::Int {
                var_name: None,
                min: "1".to_string(),
                max: "1".to_string(),
                output_format: None,
            },
            SchemaNode::Int {
                var_name: None,
                min: "2".to_string(),
                max: "2".to_string(),
                output_format: None,
            },
        ];
        let result = generate(&nodes, Some(42)).unwrap();
        assert_eq!(result, "1\n2\n");
    }

    #[test]
    fn generate_is_deterministic_with_seed() {
        let nodes = vec![SchemaNode::String {
            var_name: None,
            length: "16".to_string(),
            charset: Charset::Alphanumeric,
            custom_charset: None,
        }];
        let a = generate(&nodes, Some(123)).unwrap();
        let b = generate(&nodes, Some(123)).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn generate_without_seed_runs_successfully() {
        let nodes = vec![SchemaNode::Int {
            var_name: None,
            min: "1".to_string(),
            max: "10".to_string(),
            output_format: None,
        }];
        let result = generate(&nodes, None).unwrap();
        let v: i64 = result.trim().parse().unwrap();
        assert!((1..=10).contains(&v));
    }

    #[test]
    fn generate_propagates_error() {
        let nodes = vec![SchemaNode::Int {
            var_name: None,
            min: "10".to_string(),
            max: "1".to_string(),
            output_format: None,
        }];
        let err = generate(&nodes, Some(1)).unwrap_err();
        assert!(err.contains("greater than max"));
    }

    #[test]
    fn generate_empty_nodes_produces_empty_string() {
        let nodes: Vec<SchemaNode> = vec![];
        let result = generate(&nodes, Some(1)).unwrap();
        assert_eq!(result, "");
    }
}
