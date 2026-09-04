use crate::expr::{self, Expr, Token};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub enum CmpOp {
    Lt,
    Gt,
    Le,
    Ge,
    Eq,
    Ne,
}

#[derive(Debug, PartialEq)]
pub enum BExpr {
    Bool(bool),
    Not(Box<BExpr>),
    And(Box<BExpr>, Box<BExpr>),
    Or(Box<BExpr>, Box<BExpr>),
    Compare(Expr, CmpOp, Expr),
}

impl BExpr {
    pub fn eval(&self, env: &HashMap<String, f64>) -> Result<bool, String> {
        match self {
            BExpr::Bool(b) => Ok(*b),
            BExpr::Not(e) => Ok(!e.eval(env)?),
            BExpr::And(l, r) => Ok(l.eval(env)? && r.eval(env)?),
            BExpr::Or(l, r) => Ok(l.eval(env)? || r.eval(env)?),
            BExpr::Compare(l, op, r) => {
                let (lv, rv) = (l.eval(env)?, r.eval(env)?);
                Ok(match op {
                    CmpOp::Lt => lv < rv,
                    CmpOp::Gt => lv > rv,
                    CmpOp::Le => lv <= rv,
                    CmpOp::Ge => lv >= rv,
                    CmpOp::Eq => lv == rv,
                    CmpOp::Ne => lv != rv,
                })
            }
        }
    }
}

pub struct Parser {
    inner: expr::Parser,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self {
            inner: expr::Parser::new(tokens),
        }
    }

    pub fn parse(&mut self) -> Result<BExpr, String> {
        let expr = self.parse_or()?;
        if matches!(self.inner.peek(), Token::EOF) {
            Ok(expr)
        } else {
            Err(format!("Unexpected token: {:?}", self.inner.peek()))
        }
    }

    fn parse_or(&mut self) -> Result<BExpr, String> {
        let mut left = self.parse_and()?;
        while matches!(self.inner.peek(), Token::OrOr) {
            self.inner.consume();
            left = BExpr::Or(Box::new(left), Box::new(self.parse_and()?));
        }
        Ok(left)
    }

    fn parse_and(&mut self) -> Result<BExpr, String> {
        let mut left = self.parse_not()?;
        while matches!(self.inner.peek(), Token::AndAnd) {
            self.inner.consume();
            left = BExpr::And(Box::new(left), Box::new(self.parse_not()?));
        }
        Ok(left)
    }

    fn parse_not(&mut self) -> Result<BExpr, String> {
        if matches!(self.inner.peek(), Token::Bang) {
            self.inner.consume();
            return Ok(BExpr::Not(Box::new(self.parse_not()?)));
        }
        self.parse_cmp()
    }

    fn parse_cmp(&mut self) -> Result<BExpr, String> {
        if matches!(self.inner.peek(), Token::True | Token::False) {
            return Ok(BExpr::Bool(matches!(self.inner.consume(), Token::True)));
        }
        if matches!(self.inner.peek(), Token::LParen) {
            let save = self.inner.position();
            self.inner.consume();
            if let Ok(inner) = self.parse_or() {
                if matches!(self.inner.peek(), Token::RParen) {
                    self.inner.consume();
                    if !matches!(
                        self.inner.peek(),
                        Token::Plus
                            | Token::Minus
                            | Token::Star
                            | Token::Slash
                            | Token::Lt
                            | Token::Gt
                            | Token::Le
                            | Token::Ge
                            | Token::EqEq
                            | Token::NotEq
                    ) {
                        return Ok(inner);
                    }
                }
            }
            self.inner.seek(save);
        }

        let left = self.inner.parse_add()?;
        let op = match self.inner.peek() {
            Token::Lt => Some(CmpOp::Lt),
            Token::Gt => Some(CmpOp::Gt),
            Token::Le => Some(CmpOp::Le),
            Token::Ge => Some(CmpOp::Ge),
            Token::EqEq => Some(CmpOp::Eq),
            Token::NotEq => Some(CmpOp::Ne),
            _ => None,
        };
        match op {
            Some(op) => {
                self.inner.consume();
                let right = self.inner.parse_add()?;
                Ok(BExpr::Compare(left, op, right))
            }
            None => Ok(BExpr::Compare(left, CmpOp::Ne, Expr::Number(0.0))),
        }
    }
}

pub fn tokenize(inp: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = inp.trim().chars().collect();
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut has_decimal = false;
    let mut i = 0;

    fn flush(cur: &mut String, tokens: &mut Vec<Token>) -> Result<(), String> {
        if cur.is_empty() {
            return Ok(());
        }
        let tok = match cur.as_str() {
            "true" => Token::True,
            "false" => Token::False,
            s => {
                let mut it = s.chars();
                let is_ident = matches!(it.next(), Some(c) if c.is_alphabetic() || c == '_')
                    && it.all(|c| c.is_alphanumeric() || c == '_');
                if is_ident {
                    Token::Ident(s.to_string())
                } else {
                    s.parse::<f64>()
                        .map(Token::Number)
                        .map_err(|_| format!("Unknown token: '{s}'"))?
                }
            }
        };
        tokens.push(tok);
        cur.clear();
        Ok(())
    }

    while i < chars.len() {
        let c = chars[i];
        if c.is_alphanumeric() || c == '_' {
            cur.push(c);
            i += 1;
            continue;
        }
        if c == '.' && !has_decimal {
            cur.push(c);
            has_decimal = true;
            i += 1;
            continue;
        }
        has_decimal = false;
        flush(&mut cur, &mut tokens)?;
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        let pair = chars.get(i + 1).copied();
        match (c, pair) {
            ('<', Some('=')) => {
                tokens.push(Token::Le);
                i += 2;
            }
            ('>', Some('=')) => {
                tokens.push(Token::Ge);
                i += 2;
            }
            ('=', Some('=')) => {
                tokens.push(Token::EqEq);
                i += 2;
            }
            ('!', Some('=')) => {
                tokens.push(Token::NotEq);
                i += 2;
            }
            ('&', Some('&')) => {
                tokens.push(Token::AndAnd);
                i += 2;
            }
            ('|', Some('|')) => {
                tokens.push(Token::OrOr);
                i += 2;
            }
            _ => {
                let tok = match c {
                    '+' => Token::Plus,
                    '-' => Token::Minus,
                    '*' => Token::Star,
                    '/' => Token::Slash,
                    '(' => Token::LParen,
                    ')' => Token::RParen,
                    '<' => Token::Lt,
                    '>' => Token::Gt,
                    '!' => Token::Bang,
                    other => return Err(format!("Unknown token: '{other}'")),
                };
                tokens.push(tok);
                i += 1;
            }
        }
    }
    flush(&mut cur, &mut tokens)?;
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eval(input: &str, env: &[(&str, f64)]) -> Result<bool, String> {
        let tokens = tokenize(input)?;
        let mut parser = Parser::new(tokens);
        let ast = parser.parse()?;
        let env = env
            .iter()
            .map(|(name, value)| ((*name).to_string(), *value))
            .collect();

        ast.eval(&env)
    }

    #[test]
    fn tokenizes_boolean_and_comparison_operators() {
        assert_eq!(
            tokenize("a <= 2 && b != 3 || !false").unwrap(),
            vec![
                Token::Ident("a".into()),
                Token::Le,
                Token::Number(2.0),
                Token::AndAnd,
                Token::Ident("b".into()),
                Token::NotEq,
                Token::Number(3.0),
                Token::OrOr,
                Token::Bang,
                Token::False,
            ]
        );
    }

    #[test]
    fn evaluates_all_comparison_operators() {
        let cases = [
            ("2 < 3", true),
            ("3 > 2", true),
            ("2 <= 2", true),
            ("2 >= 2", true),
            ("2 == 2", true),
            ("2 != 3", true),
        ];

        for (input, expected) in cases {
            assert_eq!(eval(input, &[]).unwrap(), expected, "{input}");
        }
    }

    #[test]
    fn respects_boolean_precedence() {
        assert!(eval("true || false && false", &[]).unwrap());
        assert!(!eval("(true || false) && false", &[]).unwrap());
    }

    #[test]
    fn supports_not_and_grouping() {
        assert!(eval("!(2 > 3)", &[]).unwrap());
        assert!(eval("!(false || 1 < 0)", &[]).unwrap());
    }

    #[test]
    fn supports_arithmetic_inside_comparisons() {
        assert!(eval("2 + 3 * 4 == 14", &[]).unwrap());
        assert!(eval("(2 + 3) * 4 == 20", &[]).unwrap());
    }

    #[test]
    fn identifiers_use_environment_values() {
        assert!(eval("count >= limit", &[("count", 5.0), ("limit", 3.0)]).unwrap());
        assert!(!eval("count == limit", &[("count", 5.0), ("limit", 3.0)]).unwrap());
    }

    #[test]
    fn bare_numeric_expression_uses_nonzero_truthiness() {
        assert!(eval("1", &[]).unwrap());
        assert!(!eval("0", &[]).unwrap());
    }

    #[test]
    fn short_circuits_boolean_evaluation() {
        assert!(!eval("false && missing > 0", &[]).unwrap());
        assert!(eval("true || missing > 0", &[]).unwrap());
    }

    #[test]
    fn reports_unknown_variables() {
        let error = eval("missing > 0", &[]).unwrap_err();
        assert_eq!(error, "Unknown variable name: missing");
    }

    #[test]
    fn rejects_unexpected_trailing_tokens() {
        let error = eval("1 < 2 3", &[]).unwrap_err();
        assert!(error.contains("Unexpected token"));
    }

    #[test]
    fn rejects_invalid_tokens() {
        assert_eq!(tokenize("1 = 2").unwrap_err(), "Unknown token: '='");
        assert_eq!(tokenize("1 & 2").unwrap_err(), "Unknown token: '&'");
    }
}
