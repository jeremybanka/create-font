//! End-to-end corpus coverage for lossless parsing and formatting.

use create_font_fea::{FormatConfig, NewLineKind, SyntaxElement, format_fea, parse_fea};

const COMPREHENSIVE: &str = include_str!("fixtures/comprehensive.fea");
const WORKBENCH_LAYOUT: &str = include_str!("../../../fonts/workbench-sans/features/layout.fea");

fn non_trivia_tokens(element: &SyntaxElement, output: &mut Vec<(String, String)>) {
    match element {
        SyntaxElement::Node { children, .. } => {
            for child in children {
                non_trivia_tokens(child, output);
            }
        }
        SyntaxElement::Token { kind, text, .. } if kind != "Whitespace" => {
            output.push((kind.clone(), text.clone()));
        }
        SyntaxElement::Token { .. } => {}
    }
}

#[test]
fn corpus_is_lossless_and_formats_without_token_changes() {
    let config = FormatConfig {
        line_width: 88,
        indent_width: 2,
        use_tabs: false,
        new_line_kind: NewLineKind::LineFeed,
    };

    for source in [COMPREHENSIVE, WORKBENCH_LAYOUT] {
        let parsed = parse_fea(source);
        assert_eq!(parsed.root.source_text(), source);
        assert!(
            !parsed.has_errors(),
            "valid fixture produced diagnostics: {:?}",
            parsed.diagnostics
        );

        let formatted = format_fea(source, &config).expect("fixture should format");
        let reparsed = parse_fea(&formatted);
        assert!(
            !reparsed.has_errors(),
            "formatted fixture produced diagnostics: {:?}",
            reparsed.diagnostics
        );
        assert_eq!(
            format_fea(&formatted, &config).unwrap(),
            formatted,
            "formatting must be idempotent"
        );

        let mut before = Vec::new();
        let mut after = Vec::new();
        non_trivia_tokens(&parsed.root, &mut before);
        non_trivia_tokens(&reparsed.root, &mut after);
        assert_eq!(before, after, "formatting changed a source token");
    }
}
