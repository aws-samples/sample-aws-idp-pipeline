use serde::Serialize;

pub mod engine;
pub mod s3;

#[derive(Serialize)]
pub struct OcrResultItem {
    pub text: String,
    pub confidence: f32,
}

#[derive(Serialize)]
pub struct PageResult {
    pub page: usize,
    pub items: Vec<OcrResultItem>,
}

#[derive(Serialize)]
pub struct OcrResponse {
    pub pages: Vec<PageResult>,
}

// fn recognize_image(engine: &OcrEngine, image: &image::DynamicImage) -> Vec<OcrResultItem> {
//     engine
//         .recognize(image)
//         .unwrap_or_default()
//         .into_iter()
//         .map(|r| OcrResultItem {
//             text: r.text,
//             confidence: r.confidence,
//         })
//         .collect()
// }

// pub fn process_image(engine: &OcrEngine, bytes: &[u8], key: &str) -> anyhow::Result<OcrResponse> {
//     let image = image::load(Cursor::new(bytes), image::ImageFormat::from_path(key)?)?;
//     let items = recognize_image(engine, &image);
//     Ok(OcrResponse {
//         pages: vec![PageResult { page: 1, items }],
//     })
// }

// pub fn process_pdf(engine: &OcrEngine, bytes: &[u8]) -> anyhow::Result<OcrResponse> {
//     let pdfium = bind_pdfium_silent()?;
//     let document = pdfium.load_pdf_from_byte_slice(bytes, None)?;
//     let mut pages = Vec::new();

//     for (i, page) in document.pages().iter().enumerate().take(30) {
//         let config = PdfRenderConfig::new().set_target_width(2000);
//         let bitmap = page.render_with_config(&config)?;
//         let image = bitmap.as_image();
//         let items = recognize_image(engine, &image);
//         pages.push(PageResult { page: i + 1, items });
//     }

//     Ok(OcrResponse { pages })
// }

// pub fn process(engine: &OcrEngine, bytes: &[u8], key: &str) -> anyhow::Result<OcrResponse> {
//     let ext = Path::new(key)
//         .extension()
//         .and_then(|e| e.to_str())
//         .unwrap_or("")
//         .to_lowercase();

//     match ext.as_str() {
//         "pdf" => process_pdf(engine, bytes),
//         _ => process_image(engine, bytes, key),
//     }
// }
