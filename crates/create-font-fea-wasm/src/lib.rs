//! WebAssembly boundary for create-font Adobe Feature File tooling.

use create_font_fea::{ABI_VERSION, FormatConfig};
use wasm_bindgen::prelude::*;

/// Returns the serialized interface version.
#[wasm_bindgen(js_name = abiVersion)]
#[must_use]
pub fn abi_version() -> u32 {
    ABI_VERSION
}

/// Parses one feature source into the versioned lossless syntax payload.
///
/// # Errors
///
/// Returns a JavaScript exception if serialization unexpectedly fails.
#[wasm_bindgen(js_name = parseFea)]
pub fn parse_fea(source: &str) -> Result<String, JsValue> {
    create_font_fea::parse_fea_json(source).map_err(|error| JsValue::from_str(&error.to_string()))
}

/// Formats one feature source using an optional JSON configuration object.
///
/// # Errors
///
/// Returns a JavaScript exception for invalid configuration JSON or malformed
/// feature source.
#[wasm_bindgen(js_name = formatFea)]
pub fn format_fea(source: &str, config_json: &str) -> Result<String, JsValue> {
    let config = if config_json.trim().is_empty() {
        FormatConfig::default()
    } else {
        serde_json::from_str(config_json).map_err(|error| JsValue::from_str(&error.to_string()))?
    };
    create_font_fea::format_fea(source, &config)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_wrapper_returns_versioned_json() {
        let json = super::parse_fea("feature liga { sub f by f.alt; } liga;").unwrap();
        assert!(json.contains("\"abiVersion\":1"));
        assert!(json.contains("\"FeatureNode\""));
    }
}
