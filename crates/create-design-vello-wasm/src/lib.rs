//! Batched WebAssembly bindings for Create Design's Vello Hybrid WebGL2 renderer.

#![cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]

use serde::Deserialize;
use vello_common::kurbo::{Affine, BezPath, Cap, Join, Stroke};
use vello_common::paint::Color;
use vello_common::peniko::Fill;
use vello_hybrid::Scene;
#[cfg(target_arch = "wasm32")]
use vello_hybrid::{RenderSize, Resources, WebGlRenderer, WebGlTextureBindings};
use wasm_bindgen::prelude::*;
#[cfg(target_arch = "wasm32")]
use web_sys::HtmlCanvasElement;

/// Version of the JSON scene packet accepted by this binding.
pub const ABI_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenePacket {
    abi_version: u32,
    width: u16,
    height: u16,
    view: [f64; 6],
    draws: Vec<DrawPacket>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrawPacket {
    path: Vec<PathCommand>,
    fill_rule: FillRule,
    fill: Option<[u8; 4]>,
    stroke: Option<StrokePacket>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum FillRule {
    Nonzero,
    Evenodd,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StrokePacket {
    color: [u8; 4],
    width: f64,
    cap: StrokeCap,
    join: StrokeJoin,
    miter_limit: f64,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum StrokeCap {
    Butt,
    Round,
    Square,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum StrokeJoin {
    Miter,
    Round,
    Bevel,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "verb", rename_all = "lowercase")]
enum PathCommand {
    Move {
        x: f64,
        y: f64,
    },
    Line {
        x: f64,
        y: f64,
    },
    Cubic {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        x: f64,
        y: f64,
    },
    Close,
}

/// Returns the scene packet ABI version.
#[wasm_bindgen(js_name = abiVersion)]
#[must_use]
pub fn abi_version() -> u32 {
    ABI_VERSION
}

fn color([red, green, blue, alpha]: [u8; 4]) -> Color {
    Color::from_rgba8(red, green, blue, alpha)
}

fn bez_path(commands: &[PathCommand]) -> BezPath {
    let mut path = BezPath::new();
    for command in commands {
        match *command {
            PathCommand::Move { x, y } => path.move_to((x, y)),
            PathCommand::Line { x, y } => path.line_to((x, y)),
            PathCommand::Cubic {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => path.curve_to((x1, y1), (x2, y2), (x, y)),
            PathCommand::Close => path.close_path(),
        }
    }
    path
}

fn stroke(packet: &StrokePacket) -> Stroke {
    let cap = match packet.cap {
        StrokeCap::Butt => Cap::Butt,
        StrokeCap::Round => Cap::Round,
        StrokeCap::Square => Cap::Square,
    };
    let join = match packet.join {
        StrokeJoin::Miter => Join::Miter,
        StrokeJoin::Round => Join::Round,
        StrokeJoin::Bevel => Join::Bevel,
    };
    Stroke::new(packet.width)
        .with_caps(cap)
        .with_join(join)
        .with_miter_limit(packet.miter_limit)
}

fn populate_scene(scene: &mut Scene, packet: &ScenePacket) {
    scene.reset_and_resize(packet.width, packet.height);
    scene.set_transform(Affine::new(packet.view));
    for draw in &packet.draws {
        let path = bez_path(&draw.path);
        if let Some(fill) = draw.fill {
            scene.set_fill_rule(match draw.fill_rule {
                FillRule::Nonzero => Fill::NonZero,
                FillRule::Evenodd => Fill::EvenOdd,
            });
            scene.set_paint(color(fill));
            scene.fill_path(&path);
        }
        if let Some(stroke_packet) = &draw.stroke {
            scene.set_stroke(stroke(stroke_packet));
            scene.set_paint(color(stroke_packet.color));
            scene.stroke_path(&path);
        }
    }
}

fn parse_packet(packet_json: &str) -> Result<ScenePacket, String> {
    let packet: ScenePacket = serde_json::from_str(packet_json)
        .map_err(|error| format!("invalid Vello scene packet: {error}"))?;
    if packet.abi_version != ABI_VERSION {
        return Err(format!(
            "unsupported Vello scene ABI {}; expected {ABI_VERSION}",
            packet.abi_version
        ));
    }
    Ok(packet)
}

/// Owns one Vello Hybrid renderer, its GPU resources, and its reusable CPU scene.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct VelloHybridCanvasRenderer {
    renderer: WebGlRenderer,
    resources: Resources,
    scene: Scene,
    texture_bindings: WebGlTextureBindings,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl VelloHybridCanvasRenderer {
    /// Attaches Vello Hybrid to an HTML canvas with an available WebGL2 context.
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(canvas: HtmlCanvasElement) -> Self {
        let width = u16::try_from(canvas.width()).expect("canvas width exceeds Vello's u16 limit");
        let height =
            u16::try_from(canvas.height()).expect("canvas height exceeds Vello's u16 limit");
        let (renderer, resources) = WebGlRenderer::new(&canvas);
        Self {
            renderer,
            resources,
            scene: Scene::new(width, height),
            texture_bindings: WebGlTextureBindings::new(),
        }
    }

    /// Rebuilds the CPU scene from one packet and submits one GPU render operation.
    ///
    /// # Errors
    ///
    /// Returns a JavaScript exception when the scene packet or GPU render is invalid.
    #[wasm_bindgen(js_name = renderScene)]
    pub fn render_scene(&mut self, packet_json: &str) -> Result<(), JsValue> {
        let packet = parse_packet(packet_json).map_err(|error| JsValue::from_str(&error))?;
        populate_scene(&mut self.scene, &packet);
        self.renderer
            .render(
                &self.scene,
                &mut self.resources,
                &RenderSize {
                    width: u32::from(packet.width),
                    height: u32::from(packet.height),
                },
                &self.texture_bindings,
            )
            .map_err(|error| JsValue::from_str(&format!("Vello Hybrid render failed: {error}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_populates_a_batched_scene() {
        let packet = parse_packet(
			r#"{"abiVersion":1,"width":640,"height":480,"view":[1,0,0,1,0,0],"draws":[{"path":[{"verb":"move","x":1,"y":2},{"verb":"line","x":3,"y":4},{"verb":"close"}],"fillRule":"nonzero","fill":[12,34,56,255],"stroke":null}]}"#,
		)
		.unwrap();
        assert_eq!(packet.width, 640);
        assert_eq!(packet.draws.len(), 1);
        let mut scene = Scene::new(packet.width, packet.height);
        populate_scene(&mut scene, &packet);
        assert_eq!(scene.width(), 640);
        assert_eq!(scene.height(), 480);
    }

    #[test]
    fn rejects_unknown_abi_versions() {
        let error = parse_packet(
            r#"{"abiVersion":99,"width":1,"height":1,"view":[1,0,0,1,0,0],"draws":[]}"#,
        )
        .unwrap_err();
        assert!(error.contains("unsupported Vello scene ABI"));
    }
}
