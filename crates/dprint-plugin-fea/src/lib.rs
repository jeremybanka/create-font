//! dprint schema-v4 WebAssembly adapter for Adobe Feature Files.
#![cfg_attr(
    all(target_arch = "wasm32", target_os = "unknown"),
    allow(missing_docs)
)]

use create_font_fea::{FormatConfig, NewLineKind};
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
use dprint_core::generate_plugin_code;
use dprint_core::{
    configuration::{
        ConfigKeyMap, GlobalConfiguration, get_unknown_property_diagnostics, get_value,
    },
    plugins::{
        CheckConfigUpdatesMessage, ConfigChange, FileMatchingInfo, FormatError, FormatResult,
        PluginInfo, PluginResolveConfigurationResult, SyncFormatRequest, SyncHostFormatRequest,
        SyncPluginHandler,
    },
};

#[derive(Default)]
#[cfg_attr(
    not(all(target_arch = "wasm32", target_os = "unknown")),
    allow(dead_code)
)]
struct FeaPluginHandler;

impl SyncPluginHandler<FormatConfig> for FeaPluginHandler {
    fn resolve_config(
        &mut self,
        mut config: ConfigKeyMap,
        global_config: &GlobalConfiguration,
    ) -> PluginResolveConfigurationResult<FormatConfig> {
        let mut diagnostics = Vec::new();
        let line_width = get_value(
            &mut config,
            "lineWidth",
            global_config.line_width.unwrap_or(80),
            &mut diagnostics,
        );
        let indent_width = get_value(
            &mut config,
            "indentWidth",
            global_config.indent_width.unwrap_or(2),
            &mut diagnostics,
        );
        let use_tabs = get_value(
            &mut config,
            "useTabs",
            global_config.use_tabs.unwrap_or(false),
            &mut diagnostics,
        );
        let new_line_kind = match get_value(
            &mut config,
            "newLineKind",
            global_config
                .new_line_kind
                .unwrap_or(dprint_core::configuration::NewLineKind::Auto),
            &mut diagnostics,
        ) {
            dprint_core::configuration::NewLineKind::Auto => NewLineKind::Auto,
            dprint_core::configuration::NewLineKind::LineFeed => NewLineKind::LineFeed,
            dprint_core::configuration::NewLineKind::CarriageReturnLineFeed => {
                NewLineKind::CarriageReturnLineFeed
            }
        };
        diagnostics.extend(get_unknown_property_diagnostics(config));

        PluginResolveConfigurationResult {
            file_matching: FileMatchingInfo {
                file_extensions: vec!["fea".to_owned()],
                file_names: Vec::new(),
            },
            diagnostics,
            config: FormatConfig {
                line_width,
                indent_width,
                use_tabs,
                new_line_kind,
            },
        }
    }

    fn plugin_info(&mut self) -> PluginInfo {
        PluginInfo {
            name: env!("CARGO_PKG_NAME").to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            config_key: "fea".to_owned(),
            help_url: "https://github.com/jeremybanka/create-font/tree/main/packages/fea-wasm"
                .to_owned(),
            config_schema_url: String::new(),
            update_url: None,
        }
    }

    fn license_text(&mut self) -> String {
        "dprint-plugin-fea is distributed with create-font. fea-rs is MIT OR Apache-2.0; dprint-core is MIT.".to_owned()
    }

    fn check_config_updates(
        &self,
        _message: CheckConfigUpdatesMessage,
    ) -> Result<Vec<ConfigChange>, FormatError> {
        Ok(Vec::new())
    }

    fn format(
        &mut self,
        request: SyncFormatRequest<FormatConfig>,
        _format_with_host: impl FnMut(SyncHostFormatRequest) -> FormatResult,
    ) -> FormatResult {
        if request.range.is_some() {
            return Err(FormatError::from(
                "Adobe feature range formatting is not supported",
            ));
        }
        let source = String::from_utf8(request.file_bytes)?;
        let formatted = create_font_fea::format_fea(&source, request.config)
            .map_err(|error| FormatError::new(Box::new(error)))?;
        if formatted == source {
            Ok(None)
        } else {
            Ok(Some(formatted.into_bytes()))
        }
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
generate_plugin_code!(FeaPluginHandler, FeaPluginHandler, FormatConfig);
