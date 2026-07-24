//! Lossless Adobe Feature File parsing and deterministic formatting.

mod format;
mod syntax;

pub use format::{FormatConfig, FormatError, NewLineKind, format_fea};
pub use syntax::{
    ABI_VERSION, Diagnostic, ParseOutput, Severity, SourceRange, SyntaxElement, parse_fea,
    parse_fea_json,
};
