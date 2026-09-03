use crate::expr;

use winnow::{
    ascii::digit1,
    combinator::{opt, preceded},
    token::any,
    Parser, Result as PResult,
};

use core::f64;
use std::collections::HashMap;

pub struct FormatSpecs {
    pub fill: Option<char>,
    pub align: Option<char>,
    pub width: Option<usize>,
    pub precision: Option<usize>,
    pub spec_type: Option<char>,
}

pub enum Segment<'a> {
    Literal(&'a str),
    Placeholder {
        expr: &'a str,
        spec: Option<FormatSpecs>,
    },
}

fn parse_format(input: &mut &str) -> PResult<FormatSpecs> {
    let align_chars = ['<', '>', '^'];
    let (fill, align) =
        if input.len() >= 2 && align_chars.contains(&input.chars().nth(1).unwrap_or(' ')) {
            (Some(any.parse_next(input)?), Some(any.parse_next(input)?))
        } else if let Some(a) = opt(any.verify(|c| align_chars.contains(c))).parse_next(input)? {
            (None, Some(a))
        } else {
            (None, None)
        };
    let width = opt(digit1.parse_to::<usize>()).parse_next(input)?;
    let precision = opt(preceded('.', digit1.parse_to::<usize>())).parse_next(input)?;
    let spec_type = opt(any).parse_next(input)?;
    Ok(FormatSpecs {
        fill,
        align,
        width,
        precision,
        spec_type,
    })
}

fn handle_escaped_close<'a>(
    input: &'a str,
    close: usize,
    segments: &mut Vec<Segment<'a>>,
) -> Result<&'a str, String> {
    if !input[close..].starts_with("}}") {
        return Err(format!(
            "Unmatched '}}' in format string at byte {close} near '{}'",
            &input[close..]
        ));
    }
    if close > 0 {
        segments.push(Segment::Literal(&input[..close]));
    }
    segments.push(Segment::Literal("}"));
    Ok(&input[close + 2..])
}

pub fn parse_string(mut input: &str) -> Result<Vec<Segment<'_>>, String> {
    let mut segments = Vec::new();

    while !input.is_empty() {
        let open_idx = input.find('{');
        let close_idx = input.find('}');

        match (open_idx, close_idx) {
            (None, Some(close_idx)) => {
                input = handle_escaped_close(input, close_idx, &mut segments)?;
            }
            (Some(open_idx), Some(close_idx)) if close_idx < open_idx => {
                input = handle_escaped_close(input, close_idx, &mut segments)?;
            }
            (Some(open_idx), _) => {
                if open_idx > 0 {
                    segments.push(Segment::Literal(&input[..open_idx]));
                }
                if input[open_idx..].starts_with("{{") {
                    segments.push(Segment::Literal("{"));
                    input = &input[open_idx + 2..];
                    continue;
                }

                let close_idx = input[open_idx..]
                    .find('}')
                    .map(|i| open_idx + i)
                    .ok_or_else(|| format!("Unmatched '{{' in format string at byte {open_idx}"))?;

                let block = &input[open_idx + 1..close_idx];
                let (expr, spec) = match block.split_once(':') {
                    Some((e, s)) => {
                        let mut s_ref = s.trim();
                        let parsed_specs = parse_format(&mut s_ref)
                            .map_err(|err| format!("Invalid specifier '{s}': {err}"))?;
                        (e.trim(), Some(parsed_specs))
                    }
                    None => (block.trim(), None),
                };

                segments.push(Segment::Placeholder { expr, spec });
                input = &input[close_idx + 1..];
            }
            (None, None) => {
                segments.push(Segment::Literal(input));
                break;
            }
        }
    }
    Ok(segments)
}

fn format_f64(num: f64, spec: &FormatSpecs) -> String {
    let num_str = match (spec.spec_type, spec.precision) {
        (Some('e'), Some(p)) => format!("{num:.p$e}"),
        (Some('e'), None) => format!("{num:e}"),
        (Some('E'), Some(p)) => format!("{num:.p$E}"),
        (Some('E'), None) => format!("{num:E}"),
        (_, Some(p)) => format!("{num:.p$}"),
        (_, None) => format!("{num}"),
    };
    let char_count = num_str.len();
    let width = match spec.width {
        Some(w) if w > char_count => w,
        _ => return num_str,
    };
    let fill = spec.fill.unwrap_or(' ');
    let align = spec.align.unwrap_or('>');
    let pad_len = width - char_count;
    match align {
        '<' => {
            let mut result = num_str;
            result.extend(std::iter::repeat_n(fill, pad_len));
            result
        }
        '^' => {
            let left_pad = pad_len / 2;
            let right_pad = pad_len - left_pad;
            let mut result = String::with_capacity(width);
            result.extend(std::iter::repeat_n(fill, left_pad));
            result.push_str(&num_str);
            result.extend(std::iter::repeat_n(fill, right_pad));
            result
        }
        _ => {
            // '>'
            let mut result = String::with_capacity(width);
            result.extend(std::iter::repeat_n(fill, pad_len));
            result.push_str(&num_str);
            result
        }
    }
}

fn eval(
    inp: &str,
    spec: Option<FormatSpecs>,
    env: &HashMap<String, f64>,
) -> Result<String, String> {
    let tokens = expr::tokenize(inp)?;
    let num = expr::Parser::new(tokens).parse()?.eval(env)?;
    let output = match spec {
        Some(spec) => format_f64(num, &spec),
        None => num.to_string(),
    };
    Ok(output)
}

pub fn render_string(segments: Vec<Segment>, env: &HashMap<String, f64>) -> Result<String, String> {
    let mut output = String::new();
    for segment in segments {
        match segment {
            Segment::Literal(lit) => output.push_str(lit),
            Segment::Placeholder { expr, spec } => output.push_str(eval(expr, spec, env)?.as_str()),
        }
    }
    unescaper::unescape(&output).map_err(|err| format!("Failed formatting text: {err}"))
}

#[cfg(test)]
mod tests {
    use super::{parse_string, render_string, Segment};
    use std::collections::HashMap;

    #[test]
    fn parses_and_renders_expression_with_precision() {
        let segments = parse_string("value={x + 1:.2f}").unwrap();
        let mut env = HashMap::new();
        env.insert("x".to_string(), 1.25);

        assert_eq!(render_string(segments, &env).unwrap(), "value=2.25");
    }

    #[test]
    fn renders_escaped_braces_as_literals() {
        let segments = parse_string("{{value}}={x}").unwrap();
        let mut env = HashMap::new();
        env.insert("x".to_string(), 3.0);

        assert_eq!(render_string(segments, &env).unwrap(), "{value}=3");
    }

    #[test]
    fn applies_width_and_alignment() {
        let segments = parse_string("{x:*^7.1f}").unwrap();
        let mut env = HashMap::new();
        env.insert("x".to_string(), 2.0);

        assert_eq!(render_string(segments, &env).unwrap(), "**2.0**");
    }

    #[test]
    fn rejects_unmatched_braces() {
        assert!(parse_string("value={x").is_err());
        assert!(parse_string("value=x}").is_err());
    }

    #[test]
    fn parses_literal_only_input() {
        let segments = parse_string("plain text").unwrap();
        assert!(matches!(
            segments.as_slice(),
            [Segment::Literal("plain text")]
        ));
    }
}
