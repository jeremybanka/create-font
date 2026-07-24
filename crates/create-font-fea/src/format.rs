use dprint_core::{
    configuration::resolve_new_line_kind,
    formatting::{PrintItems, PrintOptions, Signal},
};
use fea_rs::Kind;
use serde::{Deserialize, Serialize};

use crate::syntax::{Diagnostic, parse_fea};

/// Newline selection for formatter output.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NewLineKind {
    /// Preserve the last newline kind observed in the source.
    #[default]
    Auto,
    /// Use line feeds.
    LineFeed,
    /// Use carriage-return line feeds.
    CarriageReturnLineFeed,
}

/// Configuration shared by the Wasm API and dprint adapter.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FormatConfig {
    /// Maximum preferred line width.
    pub line_width: u32,
    /// Indentation width in columns.
    pub indent_width: u8,
    /// Whether indentation uses tabs.
    pub use_tabs: bool,
    /// Output newline selection.
    pub new_line_kind: NewLineKind,
}

impl Default for FormatConfig {
    fn default() -> Self {
        Self {
            line_width: 80,
            indent_width: 2,
            use_tabs: false,
            new_line_kind: NewLineKind::Auto,
        }
    }
}

/// Error returned when formatting cannot safely proceed.
#[derive(Clone, Debug, thiserror::Error)]
pub enum FormatError {
    /// Syntax errors make whitespace rewriting unsafe.
    #[error("cannot format malformed Adobe feature source: {message} at bytes {start}..{end}")]
    Syntax {
        /// Parser diagnostic message.
        message: String,
        /// Start byte offset.
        start: usize,
        /// End byte offset.
        end: usize,
    },
}

#[derive(Clone, Debug)]
struct LayoutToken {
    kind: Kind,
    text: String,
    line_break_before: bool,
    blank_line_before: bool,
}

/// Formats one complete Adobe Feature File.
///
/// The formatter is fail-closed: syntax errors return an error and no partial
/// output. Every non-trivia token is emitted unchanged and in source order.
///
/// # Errors
///
/// Returns the first syntax error when the source is malformed.
pub fn format_fea(source: &str, config: &FormatConfig) -> Result<String, FormatError> {
    let parsed = parse_fea(source);
    if let Some(Diagnostic { message, range, .. }) = parsed
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.severity == crate::syntax::Severity::Error)
    {
        return Err(FormatError::Syntax {
            message: message.clone(),
            start: range.start,
            end: range.end,
        });
    }

    let tokens = collect_layout_tokens(&parsed.root);
    let newline = resolve_newline(source, config.new_line_kind);
    let output = dprint_core::formatting::format(
        || generate_print_items(&tokens),
        PrintOptions {
            indent_width: config.indent_width.max(1),
            max_width: config.line_width.max(20),
            use_tabs: config.use_tabs,
            new_line_text: newline,
        },
    );
    Ok(ensure_final_newline(output, newline))
}

fn resolve_newline(source: &str, new_line_kind: NewLineKind) -> &'static str {
    let dprint_kind = match new_line_kind {
        NewLineKind::Auto => dprint_core::configuration::NewLineKind::Auto,
        NewLineKind::LineFeed => dprint_core::configuration::NewLineKind::LineFeed,
        NewLineKind::CarriageReturnLineFeed => {
            dprint_core::configuration::NewLineKind::CarriageReturnLineFeed
        }
    };
    resolve_new_line_kind(source, dprint_kind)
}

fn ensure_final_newline(mut output: String, newline: &str) -> String {
    while output.ends_with('\n') || output.ends_with('\r') {
        output.pop();
    }
    output.push_str(newline);
    output
}

fn collect_layout_tokens(root: &crate::syntax::SyntaxElement) -> Vec<LayoutToken> {
    let mut tokens = Vec::new();
    let mut whitespace_newlines = 0;
    collect_tokens(root, &mut whitespace_newlines, &mut tokens);
    tokens
}

fn collect_tokens(
    element: &crate::syntax::SyntaxElement,
    whitespace_newlines: &mut usize,
    tokens: &mut Vec<LayoutToken>,
) {
    match element {
        crate::syntax::SyntaxElement::Node { children, .. } => {
            for child in children {
                collect_tokens(child, whitespace_newlines, tokens);
            }
        }
        crate::syntax::SyntaxElement::Token { kind, text, .. } => {
            if kind == "Whitespace" {
                *whitespace_newlines += text.chars().filter(|character| *character == '\n').count();
                return;
            }
            let token_kind = token_kind_from_name(kind, text);
            tokens.push(LayoutToken {
                kind: token_kind,
                text: text.clone(),
                line_break_before: *whitespace_newlines > 0,
                blank_line_before: *whitespace_newlines >= 2,
            });
            *whitespace_newlines = 0;
        }
    }
}

fn token_kind_from_name(kind: &str, text: &str) -> Kind {
    match kind {
        "Comment" => Kind::Comment,
        "Whitespace" => Kind::Whitespace,
        _ => punctuation_kind(text).unwrap_or(Kind::Ident),
    }
}

fn punctuation_kind(text: &str) -> Option<Kind> {
    Some(match text {
        "{" => Kind::LBrace,
        "}" => Kind::RBrace,
        "[" => Kind::LSquare,
        "]" => Kind::RSquare,
        "(" => Kind::LParen,
        ")" => Kind::RParen,
        "<" => Kind::LAngle,
        ">" => Kind::RAngle,
        ";" => Kind::Semi,
        "," => Kind::Comma,
        ":" => Kind::Colon,
        "=" => Kind::Eq,
        "'" => Kind::SingleQuote,
        "\\" => Kind::Backslash,
        "-" => Kind::Hyphen,
        "/" => Kind::Slash,
        "+" => Kind::Plus,
        "*" => Kind::Asterisk,
        "$" => Kind::Dollar,
        _ => return None,
    })
}

#[allow(clippy::too_many_lines)]
fn generate_print_items(tokens: &[LayoutToken]) -> PrintItems {
    let mut items = PrintItems::new();
    let mut state = LayoutState::default();

    for (index, token) in tokens.iter().enumerate() {
        let next = tokens.get(index + 1);
        if token.blank_line_before && !matches!(token.kind, Kind::RBrace) {
            if !state.at_line_start {
                state.newline(&mut items);
            }
            state.newline(&mut items);
        }

        match token.kind {
            Kind::Comment => {
                if !state.at_line_start {
                    items.push_signal(Signal::SpaceIfNotTrailing);
                }
                items.push_string(token.text.clone());
                state.newline(&mut items);
            }
            Kind::LBrace => {
                state.space_before(&mut items, token);
                items.push_string(token.text.clone());
                items.push_signal(Signal::StartIndent);
                state.newline(&mut items);
                state.brace_depth += 1;
            }
            Kind::RBrace => {
                items.push_signal(Signal::FinishIndent);
                if !state.at_line_start {
                    state.newline(&mut items);
                }
                items.push_string(token.text.clone());
                state.at_line_start = false;
                state.brace_depth = state.brace_depth.saturating_sub(1);
            }
            Kind::Semi => {
                items.push_string(token.text.clone());
                state.at_line_start = false;
                if state.bracket_depth == 0
                    && state.angle_depth == 0
                    && state.paren_depth == 0
                    && !matches!(
                        next,
                        Some(LayoutToken {
                            kind: Kind::Comment,
                            line_break_before: false,
                            ..
                        })
                    )
                {
                    state.newline(&mut items);
                }
            }
            Kind::LSquare => {
                state.space_before(&mut items, token);
                items.push_string(token.text.clone());
                state.at_line_start = false;
                state.bracket_depth += 1;
            }
            Kind::RSquare => {
                items.push_string(token.text.clone());
                state.at_line_start = false;
                state.bracket_depth = state.bracket_depth.saturating_sub(1);
            }
            Kind::LAngle => {
                state.space_before(&mut items, token);
                items.push_string(token.text.clone());
                state.at_line_start = false;
                state.angle_depth += 1;
            }
            Kind::RAngle => {
                items.push_string(token.text.clone());
                state.at_line_start = false;
                state.angle_depth = state.angle_depth.saturating_sub(1);
            }
            Kind::LParen => {
                items.push_string(token.text.clone());
                state.at_line_start = false;
                state.paren_depth += 1;
            }
            Kind::RParen => {
                items.push_string(token.text.clone());
                state.at_line_start = false;
                state.paren_depth = state.paren_depth.saturating_sub(1);
            }
            Kind::Comma => {
                items.push_string(token.text.clone());
                if !matches!(next.map(|next| next.kind), Some(Kind::Comment)) {
                    items.push_signal(Signal::SpaceOrNewLine);
                }
                state.at_line_start = false;
            }
            Kind::Eq => {
                if !state.at_line_start {
                    items.push_space();
                }
                items.push_string(token.text.clone());
                if !matches!(next.map(|next| next.kind), Some(Kind::Comment)) {
                    items.push_space();
                }
                state.at_line_start = false;
            }
            _ => {
                state.space_before(&mut items, token);
                items.push_string(token.text.clone());
                state.at_line_start = false;
            }
        }
        state.previous = Some(token.clone());
    }

    items
}

struct LayoutState {
    previous: Option<LayoutToken>,
    at_line_start: bool,
    brace_depth: usize,
    bracket_depth: usize,
    angle_depth: usize,
    paren_depth: usize,
}

impl Default for LayoutState {
    fn default() -> Self {
        Self {
            previous: None,
            at_line_start: true,
            brace_depth: 0,
            bracket_depth: 0,
            angle_depth: 0,
            paren_depth: 0,
        }
    }
}

impl LayoutState {
    fn newline(&mut self, items: &mut PrintItems) {
        items.push_signal(Signal::NewLine);
        self.at_line_start = true;
    }

    fn space_before(&mut self, items: &mut PrintItems, current: &LayoutToken) {
        if self.at_line_start {
            return;
        }
        if let Some(previous) = &self.previous
            && needs_space(previous, current)
        {
            items.push_signal(Signal::SpaceOrNewLine);
        }
    }
}

fn needs_space(previous: &LayoutToken, current: &LayoutToken) -> bool {
    if matches!(
        current.kind,
        Kind::RBrace
            | Kind::RSquare
            | Kind::RParen
            | Kind::RAngle
            | Kind::Semi
            | Kind::Comma
            | Kind::Colon
            | Kind::SingleQuote
            | Kind::Hyphen
            | Kind::Slash
    ) {
        return false;
    }
    if matches!(
        previous.kind,
        Kind::LBrace
            | Kind::LSquare
            | Kind::LParen
            | Kind::LAngle
            | Kind::Backslash
            | Kind::Hyphen
            | Kind::Slash
            | Kind::Dollar
            | Kind::Eq
            | Kind::Comma
    ) {
        return false;
    }
    !matches!(current.kind, Kind::LParen)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: FormatConfig = FormatConfig {
        line_width: 80,
        indent_width: 2,
        use_tabs: false,
        new_line_kind: NewLineKind::LineFeed,
    };

    #[test]
    fn formats_blocks_classes_comments_and_includes() {
        let source = "# lead\n@include=[a b c];\ninclude(shared.fea);\nfeature liga{sub f i by f_i;# inline\n}liga;";
        let expected = "# lead\n@include = [a b c];\ninclude(shared.fea);\nfeature liga {\n  sub f i by f_i; # inline\n} liga;\n";
        assert_eq!(format_fea(source, &CONFIG).unwrap(), expected);
    }

    #[test]
    fn formatting_is_idempotent() {
        let source = "feature calt { sub a' f by a.alt; } calt;";
        let once = format_fea(source, &CONFIG).unwrap();
        let twice = format_fea(&once, &CONFIG).unwrap();
        assert_eq!(once, twice);
    }

    #[test]
    fn refuses_to_format_malformed_source() {
        let source = "feature liga { sub f by ; } liga;";
        assert!(matches!(
            format_fea(source, &CONFIG),
            Err(FormatError::Syntax { .. })
        ));
    }

    #[test]
    fn preserves_crlf_when_auto() {
        let source = "feature liga {\r\nsub f by f.alt;\r\n} liga;\r\n";
        let output = format_fea(source, &FormatConfig::default()).unwrap();
        assert!(output.contains("\r\n"));
        assert!(!output.replace("\r\n", "").contains('\n'));
    }

    #[test]
    fn preserves_leading_block_inline_and_trailing_comments() {
        let source = "# leading\n\nfeature calt{# block\nlookup Inner{sub a by a.alt;}Inner;\nsub a' f by a.alt;# inline\n}calt;# trailing\n";
        let output = format_fea(source, &CONFIG).unwrap();

        assert!(output.starts_with("# leading\n\nfeature calt {\n  # block\n"));
        assert!(output.contains("lookup Inner {\n    sub a by a.alt;\n  } Inner;"));
        assert!(output.contains("sub a' f by a.alt; # inline\n"));
        assert!(output.ends_with("} calt; # trailing\n"));
        for comment in ["# leading", "# block", "# inline", "# trailing"] {
            assert_eq!(output.matches(comment).count(), 1);
        }
        assert_eq!(format_fea(&output, &CONFIG).unwrap(), output);
    }

    #[test]
    fn wraps_long_glyph_classes_without_changing_tokens() {
        let source = "@Long=[A B C D E F G H I J K L M N O P Q R S T U V W X Y Z];";
        let config = FormatConfig {
            line_width: 28,
            ..CONFIG
        };
        let output = format_fea(source, &config).unwrap();

        assert!(output.lines().count() > 1);
        assert_eq!(format_fea(&output, &config).unwrap(), output);
        assert!(!parse_fea(&output).has_errors());
    }
}
