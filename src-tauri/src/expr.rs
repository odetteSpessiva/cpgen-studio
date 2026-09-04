use std::collections::HashMap;
#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
}

impl Op {
    pub fn as_str(&self) -> &str {
        match self {
            Op::Add => "+",
            Op::Sub => "-",
            Op::Div => "/",
            Op::Mul => "*",
        }
    }
}

impl TryFrom<Token> for Op {
    type Error = String;
    fn try_from(value: Token) -> Result<Self, Self::Error> {
        match value {
            Token::Plus => Ok(Op::Add),
            Token::Minus => Ok(Op::Sub),
            Token::Star => Ok(Op::Mul),
            Token::Slash => Ok(Op::Div),
            other => Err(format!("Unexpected operator: {:?}", other)),
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Expr {
    Number(f64),
    Variable(String),
    BinaryOp {
        left: Box<Expr>,
        op: Op,
        right: Box<Expr>,
    },
}

#[derive(Debug, PartialEq, Clone)]
#[allow(clippy::upper_case_acronyms)]
pub enum Token {
    Number(f64),
    Ident(String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
    EOF,
    True,
    False,
    Lt,
    Gt,
    Le,
    Ge,
    EqEq,
    NotEq,
    AndAnd,
    OrOr,
    Bang,
}

impl TryFrom<&str> for Token {
    type Error = String;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        let is_ident = |s: &str| {
            let mut chars = s.chars();
            matches! (chars.next(), Some(c) if c.is_alphabetic() || c == '_')
                && chars.all(|c| c.is_alphanumeric() || c == '_')
        };

        match value {
            "+" => Ok(Token::Plus),
            "-" => Ok(Token::Minus),
            "*" => Ok(Token::Star),
            "/" => Ok(Token::Slash),
            "(" => Ok(Token::LParen),
            ")" => Ok(Token::RParen),
            "EOF" => Ok(Token::EOF),
            _ => {
                if is_ident(value) {
                    Ok(Token::Ident(value.to_string()))
                } else if let Ok(num) = value.parse::<f64>() {
                    Ok(Token::Number(num))
                } else {
                    Err(format!("Unknown token: '{value}'"))
                }
            }
        }
    }
}

pub struct Parser {
    tokens: Vec<Token>,
    cur: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, cur: 0 }
    }

    pub fn peek(&self) -> &Token {
        if self.cur >= self.tokens.len() {
            return &Token::EOF;
        }
        &self.tokens[self.cur]
    }

    pub fn _look_ahead(&self, count: usize) -> &Token {
        if self.cur + count >= self.tokens.len() {
            return &Token::EOF;
        }
        &self.tokens[self.cur + count]
    }

    pub fn consume(&mut self) -> Token {
        if self.cur >= self.tokens.len() {
            return Token::EOF;
        }
        self.cur += 1;
        self.tokens[self.cur - 1].clone()
    }

    pub fn parse_add(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_mul()?;
        while matches!(self.peek(), Token::Plus | Token::Minus) {
            let op = self.consume();
            let right = self.parse_mul()?;
            left = Expr::BinaryOp {
                left: Box::new(left),
                op: Op::try_from(op)?,
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    pub fn parse_mul(&mut self) -> Result<Expr, String> {
        let mut left = self.parse_primary()?;
        while matches!(self.peek(), Token::Star | Token::Slash) {
            let op = self.consume();
            let right = self.parse_primary()?;
            left = Expr::BinaryOp {
                left: Box::new(left),
                op: Op::try_from(op)?,
                right: Box::new(right),
            };
        }
        Ok(left)
    }

    pub fn parse_primary(&mut self) -> Result<Expr, String> {
        match self.peek() {
            &Token::Plus => {
                self.consume();
                self.parse_primary()
            }
            &Token::Minus => {
                self.consume();
                Ok(Expr::BinaryOp {
                    left: Box::new(Expr::Number(0f64)),
                    op: Op::Sub,
                    right: Box::new(self.parse_primary()?),
                })
            }
            &Token::LParen => {
                self.consume();
                let expr = self.parse_add()?;
                if self.consume() != Token::RParen {
                    return Err("Expected matching ')'".to_string());
                }
                Ok(expr)
            }
            &Token::Number(num) => {
                let value = num;
                self.consume();
                Ok(Expr::Number(value))
            }
            Token::Ident(var) => {
                let name = var.to_owned();
                self.consume();
                Ok(Expr::Variable(name))
            }
            other => Err(format!("Unexpected token: {:?}", other)),
        }
    }

    pub fn parse(&mut self) -> Result<Expr, String> {
        let ast = self.parse_add()?;
        if matches!(self.peek(), Token::EOF) {
            return Ok(ast);
        }
        Err(format!("Unexpected token: {:?}", self.peek()))
    }

    pub fn position(&self) -> usize {
        self.cur
    }

    pub fn seek(&mut self, pos: usize) {
        self.cur = pos;
    }
}

impl Expr {
    pub fn eval(&self, env: &HashMap<String, f64>) -> Result<f64, String> {
        match self {
            Expr::Number(val) => Ok(*val),
            Expr::Variable(name) => match env.get(name) {
                Some(val) => Ok(*val),
                None => Err(format!("Unknown variable name: {name}")),
            },
            Expr::BinaryOp { left, op, right } => {
                let left_val = left.eval(env)?;
                let right_val = right.eval(env)?;
                match op.as_str() {
                    "+" => Ok(left_val + right_val),
                    "-" => Ok(left_val - right_val),
                    "*" => Ok(left_val * right_val),
                    "/" => Ok(left_val / right_val),
                    _ => Err(format!("Unexpected operator: {:?}", op)),
                }
            }
        }
    }
}

pub fn tokenize(inp: &str) -> Result<Vec<Token>, String> {
    let mut tokens: Vec<Token> = Vec::new();
    let mut cur = String::new();
    let mut has_decimal = false;
    for c in inp.trim().chars() {
        if c.is_alphanumeric() || c == '_' {
            cur.push(c);
        } else if c == '.' && !has_decimal {
            cur.push(c);
            has_decimal = true;
        } else {
            has_decimal = false;
            if !cur.is_empty() {
                tokens.push(Token::try_from(cur.as_str())?);
                cur.clear();
            }
            if !c.is_whitespace() {
                tokens.push(Token::try_from(c.to_string().as_str())?);
            }
        }
    }
    if !cur.is_empty() {
        tokens.push(Token::try_from(cur.as_str())?);
    }
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_from_operators() {
        assert_eq!(Token::try_from("+").unwrap(), Token::Plus);
        assert_eq!(Token::try_from("-").unwrap(), Token::Minus);
        assert_eq!(Token::try_from("*").unwrap(), Token::Star);
        assert_eq!(Token::try_from("/").unwrap(), Token::Slash);
    }

    #[test]
    #[allow(clippy::approx_constant)]
    fn test_token_from_numbers() {
        assert_eq!(Token::try_from("42").unwrap(), Token::Number(42.0));
        assert_eq!(Token::try_from("3.1415").unwrap(), Token::Number(3.1415f64));
    }

    #[test]
    fn test_token_from_unknown_panics() {
        let e = Token::try_from("@").unwrap_err();
        assert_eq!(e, "Unknown token: '@'");
    }

    #[test]
    fn test_parser_peek_and_consume() {
        let tokens = vec![Token::Number(1.0), Token::Plus, Token::EOF];
        let mut parser = Parser::new(tokens);

        // Peek should look ahead but NOT advance
        assert_eq!(parser.peek(), &Token::Number(1.0));
        assert_eq!(parser.peek(), &Token::Number(1.0));

        // Consume should advance and return the owned token
        assert_eq!(parser.consume(), Token::Number(1.0));

        // Peek should now see the next one
        assert_eq!(parser.peek(), &Token::Plus);
        assert_eq!(parser.consume(), Token::Plus);

        // Safe fallback to EOF when empty
        assert_eq!(parser.peek(), &Token::EOF);
        assert_eq!(parser.consume(), Token::EOF);
    }

    #[test]
    fn test_parse_primary_number() {
        let tokens = vec![Token::Number(5.0)];
        let mut parser = Parser::new(tokens);

        let result = parser.parse_primary().unwrap();
        assert_eq!(result, Expr::Number(5.0));
    }

    #[test]
    fn test_parse_primary_unary_minus() {
        // Tests the internal conversion of "-5" into "0 - 5"
        let tokens = vec![Token::Minus, Token::Number(5.0)];
        let mut parser = Parser::new(tokens);

        let result = parser.parse_primary().unwrap();
        assert_eq!(
            result,
            Expr::BinaryOp {
                left: Box::new(Expr::Number(0.0)),
                op: Op::Sub,
                right: Box::new(Expr::Number(5.0)),
            }
        );
    }

    #[test]
    fn test_parse_primary_invalid_token_error() {
        // Tests that unexpected tokens return an error string instead of crashing
        let tokens = vec![Token::Plus]; // Starting an expression with a random binary '+'
        let mut parser = Parser::new(tokens);

        let result = parser.parse_primary();
        assert!(result.is_err());
    }

    #[test]
    #[allow(clippy::approx_constant)]
    fn test_tokenize_decimal_literal() {
        let tokens = tokenize("3.1415").unwrap();
        assert_eq!(tokens, vec![Token::Number(3.1415)]);
    }

    #[test]
    fn test_tokenize_multiple_decimals_in_expression() {
        let tokens = tokenize("1.5 + 2.25").unwrap();
        assert_eq!(
            tokens,
            vec![Token::Number(1.5), Token::Plus, Token::Number(2.25)]
        );
    }

    #[test]
    fn test_tokenize_identifier() {
        let tokens = tokenize("N").unwrap();
        assert_eq!(tokens, vec![Token::Ident("N".to_string())]);
    }

    #[test]
    fn test_tokenize_identifier_with_digits_and_underscore() {
        let tokens = tokenize("max_N2").unwrap();
        assert_eq!(tokens, vec![Token::Ident("max_N2".to_string())]);
    }

    #[test]
    fn test_tokenize_identifier_cannot_start_with_digit() {
        let e = tokenize("1N").unwrap_err();
        assert_eq!(e, "Unknown token: '1N'");
    }

    #[test]
    fn test_tokenize_negative_number_splits_into_minus_and_number() {
        let tokens = tokenize("-0.5").unwrap();
        assert_eq!(tokens, vec![Token::Minus, Token::Number(0.5)]);
    }

    #[test]
    fn test_tokenize_variable_expression() {
        let tokens = tokenize("N * 2").unwrap();
        assert_eq!(
            tokens,
            vec![
                Token::Ident("N".to_string()),
                Token::Star,
                Token::Number(2.0)
            ]
        );
    }

    #[test]
    fn test_parse_primary_variable() {
        let tokens = vec![Token::Ident("N".to_string())];
        let mut parser = Parser::new(tokens);
        let result = parser.parse_primary().unwrap();
        assert_eq!(result, Expr::Variable("N".to_string()));
    }

    #[test]
    fn test_parse_variable_in_binary_expr() {
        let tokens = tokenize("N + 1").unwrap();
        let mut parser = Parser::new(tokens);
        let ast = parser.parse().unwrap();
        assert_eq!(
            ast,
            Expr::BinaryOp {
                left: Box::new(Expr::Variable("N".to_string())),
                op: Op::Add,
                right: Box::new(Expr::Number(1.0)),
            }
        );
    }

    #[test]
    fn test_eval_resolves_bound_variable() {
        let tokens = tokenize("N * 2").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();

        let mut env = HashMap::new();
        env.insert("N".to_string(), 5.0);

        assert_eq!(ast.eval(&env).unwrap(), 10.0);
    }

    #[test]
    fn test_eval_multiple_variables() {
        let tokens = tokenize("(N + T) * 2").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();

        let mut env = HashMap::new();
        env.insert("N".to_string(), 3.0);
        env.insert("T".to_string(), 4.0);

        assert_eq!(ast.eval(&env).unwrap(), 14.0);
    }

    #[test]
    fn test_eval_same_ast_different_envs() {
        let tokens = tokenize("N * 2").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();

        for (n, expected) in [(1.0, 2.0), (5.0, 10.0), (100.0, 200.0)] {
            let mut env = HashMap::new();
            env.insert("N".to_string(), n);
            assert_eq!(ast.eval(&env).unwrap(), expected);
        }
    }

    #[test]
    fn test_eval_nested_expression_with_variables() {
        let tokens = tokenize("(N - 1) * (T + 2)").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();

        let mut env = HashMap::new();
        env.insert("N".to_string(), 10.0);
        env.insert("T".to_string(), 3.0);

        // (10 - 1) * (3 + 2) = 9 * 5 = 45
        assert_eq!(ast.eval(&env).unwrap(), 45.0);
    }

    #[test]
    fn test_eval_unary_minus_on_variable() {
        let tokens = tokenize("-N").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();

        let mut env = HashMap::new();
        env.insert("N".to_string(), 7.0);

        assert_eq!(ast.eval(&env).unwrap(), -7.0);
    }

    #[test]
    fn test_eval_number_still_works_with_empty_env() {
        let tokens = tokenize("2 + 3 * 4").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        let env: HashMap<String, f64> = HashMap::new();

        assert_eq!(ast.eval(&env).unwrap(), 14.0);
    }

    #[test]
    fn test_eval_undefined_variable_errors() {
        let tokens = tokenize("N + 1").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();

        let env: HashMap<String, f64> = HashMap::new();
        let result = ast.eval(&env);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains('N'));
    }

    #[test]
    fn test_eval_partial_env_missing_one_variable_errors() {
        let tokens = tokenize("N + T").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();

        let mut env = HashMap::new();
        env.insert("N".to_string(), 5.0);

        assert!(ast.eval(&env).is_err());
    }

    #[test]
    fn test_eval_division_by_zero_is_non_finite_not_an_error() {
        let tokens = tokenize("N / 0").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();

        let mut env = HashMap::new();
        env.insert("N".to_string(), 5.0);

        let result = ast.eval(&env).unwrap();
        assert!(!result.is_finite());
    }

    #[test]
    fn test_eval_zero_divided_by_zero_is_nan() {
        let tokens = tokenize("0 / 0").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        let env: HashMap<String, f64> = HashMap::new();

        assert!(ast.eval(&env).unwrap().is_nan());
    }

    #[test]
    fn test_precedence_multiplication_over_addition_ast_shape() {
        // "1 + 2 * 3" must parse as 1 + (2 * 3), not (1 + 2) * 3.
        let tokens = tokenize("1 + 2 * 3").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        assert_eq!(
            ast,
            Expr::BinaryOp {
                left: Box::new(Expr::Number(1.0)),
                op: Op::Add,
                right: Box::new(Expr::BinaryOp {
                    left: Box::new(Expr::Number(2.0)),
                    op: Op::Mul,
                    right: Box::new(Expr::Number(3.0)),
                }),
            }
        );
    }

    #[test]
    fn test_precedence_division_over_subtraction_eval() {
        // 10 - 4 / 2 = 10 - 2 = 8, NOT (10 - 4) / 2 = 3.
        let tokens = tokenize("10 - 4 / 2").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        let env = HashMap::new();
        assert_eq!(ast.eval(&env).unwrap(), 8.0);
    }

    #[test]
    fn test_left_associativity_of_subtraction_ast_shape() {
        // "10 - 3 - 2" must parse as (10 - 3) - 2, not 10 - (3 - 2).
        let tokens = tokenize("10 - 3 - 2").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        assert_eq!(
            ast,
            Expr::BinaryOp {
                left: Box::new(Expr::BinaryOp {
                    left: Box::new(Expr::Number(10.0)),
                    op: Op::Sub,
                    right: Box::new(Expr::Number(3.0)),
                }),
                op: Op::Sub,
                right: Box::new(Expr::Number(2.0)),
            }
        );
        let env = HashMap::new();
        // (10 - 3) - 2 = 5, not 10 - (3 - 2) = 9.
        assert_eq!(ast.eval(&env).unwrap(), 5.0);
    }

    #[test]
    fn test_left_associativity_of_division_eval() {
        // (20 / 4) / 5 = 1, NOT 20 / (4 / 5) = 25.
        let tokens = tokenize("20 / 4 / 5").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        let env = HashMap::new();
        assert_eq!(ast.eval(&env).unwrap(), 1.0);
    }

    #[test]
    fn test_mixed_precedence_full_expression_eval() {
        // 2*3=6, 4/2=2 -> 10 - 6 + 2 = 6.
        let tokens = tokenize("10 - 2 * 3 + 4 / 2").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        let env = HashMap::new();
        assert_eq!(ast.eval(&env).unwrap(), 6.0);
    }

    #[test]
    fn test_unary_minus_binds_tighter_than_multiplication() {
        let tokens = tokenize("-N * 2").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        assert_eq!(
            ast,
            Expr::BinaryOp {
                left: Box::new(Expr::BinaryOp {
                    left: Box::new(Expr::Number(0.0)),
                    op: Op::Sub,
                    right: Box::new(Expr::Variable("N".to_string())),
                }),
                op: Op::Mul,
                right: Box::new(Expr::Number(2.0)),
            }
        );
    }

    #[test]
    fn test_double_unary_minus_cancels_out() {
        let tokens = tokenize("--5").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        let env = HashMap::new();
        assert_eq!(ast.eval(&env).unwrap(), 5.0);
    }

    #[test]
    fn test_repeated_unary_plus_is_a_no_op() {
        let tokens = tokenize("1 + + 2").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        let env = HashMap::new();
        assert_eq!(ast.eval(&env).unwrap(), 3.0);
    }

    #[test]
    fn test_parentheses_override_precedence() {
        // "(1 + 2) * 3" must NOT reduce to the same AST as "1 + 2 * 3".
        let tokens = tokenize("(1 + 2) * 3").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        let env = HashMap::new();
        assert_eq!(ast.eval(&env).unwrap(), 9.0);
    }

    #[test]
    fn test_nested_redundant_parentheses() {
        let tokens = tokenize("((1))").unwrap();
        let ast = Parser::new(tokens).parse().unwrap();
        assert_eq!(ast, Expr::Number(1.0));
    }

    #[test]
    fn test_unclosed_parenthesis_errors() {
        let tokens = tokenize("(1 + 2").unwrap();
        let result = Parser::new(tokens).parse();
        assert!(result.is_err());
    }

    #[test]
    fn test_unmatched_closing_parenthesis_errors() {
        let tokens = tokenize("1)").unwrap();
        let result = Parser::new(tokens).parse();
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_input_tokenizes_to_empty_vec() {
        assert_eq!(tokenize("").unwrap(), vec![]);
    }

    #[test]
    fn test_whitespace_only_input_tokenizes_to_empty_vec() {
        assert_eq!(tokenize("   ").unwrap(), vec![]);
    }

    #[test]
    fn test_empty_input_fails_to_parse() {
        let result = Parser::new(vec![]).parse();
        assert!(result.is_err());
    }

    #[test]
    fn test_missing_operator_between_operands_errors() {
        let tokens = tokenize("1 2").unwrap();
        let result = Parser::new(tokens).parse();
        assert!(result.is_err());
    }

    #[test]
    fn test_trailing_operator_with_no_right_operand_errors() {
        let tokens = tokenize("1 +").unwrap();
        let result = Parser::new(tokens).parse();
        assert!(result.is_err());
    }

    #[test]
    fn test_leading_binary_star_errors() {
        let tokens = tokenize("* 2").unwrap();
        let result = Parser::new(tokens).parse();
        assert!(result.is_err());
    }
}
