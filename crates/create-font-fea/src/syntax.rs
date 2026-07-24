use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use fea_rs::{
    DiagnosticSet, Node, NodeOrToken,
    parse::{SourceLoadError, SourceResolver, parse_root},
};
use serde::{Deserialize, Serialize};

/// Version of the serialized Wasm boundary.
pub const ABI_VERSION: u32 = 1;

const ROOT_PATH: &str = "document.fea";
const UNRESOLVED_INCLUDE: &str = "include resolution is a host responsibility";

/// A half-open UTF-8 byte range in the original source.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    /// Inclusive byte offset.
    pub start: usize,
    /// Exclusive byte offset.
    pub end: usize,
}

impl From<std::ops::Range<usize>> for SourceRange {
    fn from(range: std::ops::Range<usize>) -> Self {
        Self {
            start: range.start,
            end: range.end,
        }
    }
}

/// Severity of a parser diagnostic.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    /// The source is malformed.
    Error,
    /// The source is valid enough to continue, but suspicious.
    Warning,
    /// Informational parser feedback.
    Info,
}

/// A stable syntax diagnostic returned across the Wasm boundary.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    /// Stable create-font diagnostic code.
    pub code: String,
    /// Human-readable diagnostic text.
    pub message: String,
    /// Diagnostic severity.
    pub severity: Severity,
    /// Source byte range.
    pub range: SourceRange,
}

/// A serializable node or token projected from the lossless `fea-rs` tree.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SyntaxElement {
    /// A concrete syntax node produced by `fea-rs`.
    Node {
        /// Node kind name from the pinned `fea-rs` release.
        kind: String,
        /// Source byte range.
        range: SourceRange,
        /// Whether this node directly contains a parser error.
        error: bool,
        /// Direct child nodes and tokens in source order.
        children: Vec<SyntaxElement>,
    },
    /// A source token, including whitespace and comments.
    Token {
        /// Stable token kind name.
        kind: String,
        /// Source byte range.
        range: SourceRange,
        /// Exact token text.
        text: String,
    },
}

impl SyntaxElement {
    /// Returns this element's create-font-owned syntax kind.
    #[must_use]
    pub fn kind(&self) -> &str {
        match self {
            Self::Node { kind, .. } | Self::Token { kind, .. } => kind,
        }
    }

    /// Returns this element's half-open UTF-8 byte range.
    #[must_use]
    pub fn range(&self) -> &SourceRange {
        match self {
            Self::Node { range, .. } | Self::Token { range, .. } => range,
        }
    }

    /// Returns direct children for a node, or an empty slice for a token.
    #[must_use]
    pub fn children(&self) -> &[Self] {
        match self {
            Self::Node { children, .. } => children,
            Self::Token { .. } => &[],
        }
    }

    /// Returns the deepest element containing a UTF-8 byte offset.
    #[must_use]
    pub fn descendant_at(&self, offset: usize) -> Option<&Self> {
        let range = self.range();
        if offset < range.start || offset >= range.end {
            return None;
        }
        self.children()
            .iter()
            .find_map(|child| child.descendant_at(offset))
            .or(Some(self))
    }

    /// Reconstructs the exact source represented by this element.
    #[must_use]
    pub fn source_text(&self) -> String {
        match self {
            Self::Node { children, .. } => children.iter().map(Self::source_text).collect(),
            Self::Token { text, .. } => text.clone(),
        }
    }
}

/// Serializable projection of one `fea-rs` parse result.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseOutput {
    /// Serialized interface version.
    pub abi_version: u32,
    /// Original source length in UTF-8 bytes.
    pub source_len: usize,
    /// Lossless root syntax node.
    pub root: SyntaxElement,
    /// Recoverable parser diagnostics.
    pub diagnostics: Vec<Diagnostic>,
}

impl ParseOutput {
    /// Returns true when at least one syntax error was reported.
    #[must_use]
    pub fn has_errors(&self) -> bool {
        self.diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == Severity::Error)
    }
}

#[derive(Debug)]
struct SingleSourceResolver {
    source: Arc<str>,
}

impl SourceResolver for SingleSourceResolver {
    fn get_contents(&self, path: &Path) -> Result<Arc<str>, SourceLoadError> {
        if path == Path::new(ROOT_PATH) {
            Ok(Arc::clone(&self.source))
        } else {
            Err(SourceLoadError::new(path.to_path_buf(), UNRESOLVED_INCLUDE))
        }
    }

    fn canonicalize(&self, path: &Path) -> Result<PathBuf, SourceLoadError> {
        Ok(path.to_path_buf())
    }
}

/// Parses one `.fea` document without resolving includes.
///
/// Include directives remain in the lossless tree. The host is responsible for
/// loading and parsing included sources.
///
/// # Panics
///
/// Panics only if `fea-rs` fails to read the in-memory root source supplied by
/// this function's resolver, which always returns that source.
#[must_use]
pub fn parse_fea(source: &str) -> ParseOutput {
    let resolver = SingleSourceResolver {
        source: Arc::from(source),
    };
    let (tree, diagnostics) = parse_root(PathBuf::from(ROOT_PATH), None, Box::new(resolver))
        .expect("the in-memory root source is always available");

    ParseOutput {
        abi_version: ABI_VERSION,
        source_len: source.len(),
        root: node_to_syntax(tree.root()),
        diagnostics: diagnostics_to_output(&diagnostics),
    }
}

/// Parses one `.fea` document and serializes the versioned result as JSON.
///
/// # Errors
///
/// Returns an error only if serialization unexpectedly fails.
pub fn parse_fea_json(source: &str) -> Result<String, serde_json::Error> {
    serde_json::to_string(&parse_fea(source))
}

fn node_to_syntax(node: &Node) -> SyntaxElement {
    SyntaxElement::Node {
        kind: format!("{:?}", node.kind()),
        range: node.range().into(),
        error: node.error,
        children: node.iter_children().map(element_to_syntax).collect(),
    }
}

fn element_to_syntax(element: &NodeOrToken) -> SyntaxElement {
    match element {
        NodeOrToken::Node(node) => node_to_syntax(node),
        NodeOrToken::Token(token) => SyntaxElement::Token {
            kind: format!("{:?}", token.kind),
            range: token.range().into(),
            text: token.as_str().to_owned(),
        },
    }
}

fn diagnostics_to_output(diagnostics: &DiagnosticSet) -> Vec<Diagnostic> {
    diagnostics
        .diagnostics()
        .iter()
        .filter(|diagnostic| !diagnostic.text().contains(UNRESOLVED_INCLUDE))
        .map(|diagnostic| {
            let severity = match diagnostic.level {
                fea_rs::Level::Error => Severity::Error,
                fea_rs::Level::Warning => Severity::Warning,
                fea_rs::Level::Info => Severity::Info,
            };
            Diagnostic {
                code: match severity {
                    Severity::Error => "fea.syntax.error",
                    Severity::Warning => "fea.syntax.warning",
                    Severity::Info => "fea.syntax.info",
                }
                .to_owned(),
                message: diagnostic.text().to_owned(),
                severity,
                range: diagnostic.span().into(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_is_lossless_and_source_located() {
        let source = "# lead\nfeature liga {\n  sub f i by f_i; # inline\n} liga;\n";
        let parsed = parse_fea(source);
        assert_eq!(parsed.root.source_text(), source);
        assert_eq!(parsed.source_len, source.len());
        assert!(!parsed.has_errors());
    }

    #[test]
    fn include_is_preserved_without_host_resolution_error() {
        let source = "include(shared/classes.fea);\n";
        let parsed = parse_fea(source);
        assert_eq!(parsed.root.source_text(), source);
        assert!(parsed.diagnostics.is_empty());
        assert!(
            serde_json::to_string(&parsed)
                .unwrap()
                .contains("IncludeNode")
        );
    }

    #[test]
    fn malformed_source_returns_a_recoverable_tree() {
        let source = "feature liga { sub f by ; sub a by b; } liga;";
        let parsed = parse_fea(source);
        assert_eq!(parsed.root.source_text(), source);
        assert!(parsed.has_errors());
        assert!(
            parsed
                .diagnostics
                .iter()
                .all(|diagnostic| { diagnostic.range.end <= source.len() })
        );
    }

    #[test]
    fn utf8_ranges_and_queries_address_exact_source_text() {
        fn assert_token_ranges(element: &SyntaxElement, source: &str) {
            if let SyntaxElement::Token { range, text, .. } = element {
                assert_eq!(&source[range.start..range.end], text);
            }
            for child in element.children() {
                assert_token_ranges(child, source);
            }
        }

        let source = "# café\nfeature liga { sub a by a.alt; } liga;\n";
        let parsed = parse_fea(source);
        assert!(!parsed.has_errors());
        assert_token_ranges(&parsed.root, source);
        let accented_byte = source.find('é').unwrap();
        let token = parsed.root.descendant_at(accented_byte).unwrap();
        assert_eq!(token.kind(), "Comment");
        assert_eq!(token.source_text(), "# café");
    }
}
