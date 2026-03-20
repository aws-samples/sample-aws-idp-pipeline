use ocr_rs::{OcrEngine, OcrEngineBuilder};
use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct BBox {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Debug)]
pub struct OcrResultItem {
    pub text: String,
    pub confidence: f32,
    pub bbox: BBox,
}

pub fn create_engine() -> anyhow::Result<OcrEngine> {
    let engine = OcrEngineBuilder::new()
        .with_det_model_path("models/PP-OCRv5_server_det.mnn")
        .with_rec_model_path("models/korean_PP-OCRv5_mobile_rec_infer.mnn")
        .with_charset_path("models/ppocr_keys_korean.txt")
        .build()?;

    Ok(engine)
}

pub fn recognize_image(engine: &OcrEngine, image: &image::DynamicImage) -> Vec<OcrResultItem> {
    engine
        .recognize(image)
        .unwrap_or_default()
        .into_iter()
        .map(|r| OcrResultItem {
            text: r.text,
            confidence: r.confidence,
            bbox: BBox {
                x: r.bbox.rect.left(),
                y: r.bbox.rect.top(),
                width: r.bbox.rect.width(),
                height: r.bbox.rect.height(),
            },
        })
        .collect()
}
