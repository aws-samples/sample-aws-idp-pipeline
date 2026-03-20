use std::io::Cursor;
use std::path::Path;

use ocr_rs::OcrEngine;
use pdfium_auto::bind_pdfium_silent;
use pdfium_render::prelude::PdfRenderConfig;
use serde::Serialize;

use crate::engine::recognize_image;

pub mod engine;
pub mod s3;

#[derive(Serialize)]
pub struct PageResult {
    pub page: usize,
    pub items: Vec<engine::OcrResultItem>,
}

#[derive(Serialize)]
pub struct OcrResponse {
    pub pages: Vec<PageResult>,
}

pub fn process_image(engine: &OcrEngine, bytes: &[u8], key: &str) -> anyhow::Result<OcrResponse> {
    let image = image::load(Cursor::new(bytes), image::ImageFormat::from_path(key)?)?;
    let items = recognize_image(engine, &image);
    Ok(OcrResponse {
        pages: vec![PageResult { page: 0, items }],
    })
}

pub fn process_pdf(
    engine: &OcrEngine,
    bytes: &[u8],
    from: usize,
    to: usize,
) -> anyhow::Result<OcrResponse> {
    let pdfium = bind_pdfium_silent()?;
    let document = pdfium.load_pdf_from_byte_slice(bytes, None)?;
    let page_count = document.pages().len() as usize;
    let to = to.min(page_count.saturating_sub(1));
    let mut pages = Vec::new();

    for i in from..=to {
        let page = document.pages().get(i as u16)?;
        let config = PdfRenderConfig::new().set_target_width(2000);
        let bitmap = page.render_with_config(&config)?;
        let image = bitmap.as_image();
        let items = recognize_image(engine, &image);
        pages.push(PageResult { page: i, items });
    }

    Ok(OcrResponse { pages })
}

pub fn process(
    engine: &OcrEngine,
    bytes: &[u8],
    key: &str,
    from: Option<usize>,
    to: Option<usize>,
) -> anyhow::Result<OcrResponse> {
    let ext = Path::new(key)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "pdf" => {
            let from = from.unwrap_or(0);
            let to = to.unwrap_or(usize::MAX);
            process_pdf(engine, bytes, from, to)
        }
        _ => process_image(engine, bytes, key),
    }
}
