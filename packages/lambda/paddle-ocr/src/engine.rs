use ocr_rs::{OcrEngine, OcrEngineBuilder, OcrEngineConfig, det::DetOptions};
use serde::{Deserialize, Serialize};

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

#[derive(Deserialize, Debug, Clone, Copy, Default)]
pub struct OrientationOptions {
    #[serde(default)]
    pub use_doc_orientation_classify: bool,
}

#[derive(Deserialize, Debug, Clone, Copy, Default)]
pub enum Language {
    #[serde(rename = "ko", alias = "korean")]
    Korean,
    #[serde(rename = "en")]
    English,
    #[serde(rename = "zh", alias = "ch", alias = "chinese_cht")]
    Chinese,
    #[serde(
        rename = "ar",
        alias = "fa",
        alias = "ug",
        alias = "ur",
        alias = "ps",
        alias = "ku",
        alias = "sd",
        alias = "bal"
    )]
    Arabic,
    #[serde(
        rename = "ru",
        alias = "uk",
        alias = "be",
        alias = "bg",
        alias = "sr",
        alias = "mk",
        alias = "mn",
        alias = "kk",
        alias = "ky",
        alias = "tg",
        alias = "tt",
        alias = "uz",
        alias = "az",
        alias = "mo",
        alias = "ba",
        alias = "cv",
        alias = "mhr",
        alias = "udm",
        alias = "kv",
        alias = "os",
        alias = "bua",
        alias = "xal",
        alias = "tyv",
        alias = "sah",
        alias = "kaa",
        alias = "ab",
        alias = "ady",
        alias = "kbd",
        alias = "av",
        alias = "dar",
        alias = "inh",
        alias = "ce",
        alias = "lki",
        alias = "lez",
        alias = "tab"
    )]
    Cyrillic,
    #[serde(
        rename = "hi",
        alias = "mr",
        alias = "ne",
        alias = "bh",
        alias = "mai",
        alias = "bho",
        alias = "mah",
        alias = "sck",
        alias = "new",
        alias = "gom",
        alias = "sa",
        alias = "bgc",
        alias = "pi"
    )]
    Devanagari,
    #[serde(rename = "el")]
    Greek,
    #[serde(rename = "eslav")]
    EastSlavic,
    #[serde(
        rename = "la",
        alias = "fr",
        alias = "de",
        alias = "af",
        alias = "it",
        alias = "es",
        alias = "bs",
        alias = "pt",
        alias = "cs",
        alias = "cy",
        alias = "da",
        alias = "et",
        alias = "ga",
        alias = "hr",
        alias = "hu",
        alias = "rs_latin",
        alias = "id",
        alias = "oc",
        alias = "is",
        alias = "lt",
        alias = "mi",
        alias = "ms",
        alias = "nl",
        alias = "no",
        alias = "pl",
        alias = "sk",
        alias = "sl",
        alias = "sq",
        alias = "sv",
        alias = "sw",
        alias = "tl",
        alias = "tr",
        alias = "lv",
        alias = "mt",
        alias = "vi",
        alias = "fi",
        alias = "eu",
        alias = "gl",
        alias = "lb",
        alias = "rm",
        alias = "ca",
        alias = "qu",
        alias = "ro"
    )]
    Latin,
    #[serde(rename = "ta")]
    Tamil,
    #[serde(rename = "te")]
    Telugu,
    #[serde(rename = "th")]
    Thai,
    #[default]
    #[serde(other)]
    Fallback,
}

impl Language {
    fn rec_model_path(&self) -> &'static str {
        match self {
            Language::Korean => "models/korean_PP-OCRv5_mobile_rec_infer.mnn",
            Language::English => "models/en_PP-OCRv5_mobile_rec_infer.mnn",
            Language::Chinese => "models/ch_PP-OCRv4_rec_infer.mnn",
            Language::Arabic => "models/arabic_PP-OCRv5_mobile_rec_infer.mnn",
            Language::Cyrillic => "models/cyrillic_PP-OCRv5_mobile_rec_infer.mnn",
            Language::Devanagari => "models/devanagari_PP-OCRv5_mobile_rec_infer.mnn",
            Language::Greek => "models/el_PP-OCRv5_mobile_rec_infer.mnn",
            Language::EastSlavic => "models/eslav_PP-OCRv5_mobile_rec_infer.mnn",
            Language::Latin => "models/latin_PP-OCRv5_mobile_rec_infer.mnn",
            Language::Tamil => "models/ta_PP-OCRv5_mobile_rec_infer.mnn",
            Language::Telugu => "models/te_PP-OCRv5_mobile_rec_infer.mnn",
            Language::Thai => "models/th_PP-OCRv5_mobile_rec_infer.mnn",
            Language::Fallback => "models/PP-OCRv5_mobile_rec.mnn",
        }
    }

    fn charset_path(&self) -> &'static str {
        match self {
            Language::Korean => "models/ppocr_keys_korean.txt",
            Language::English => "models/ppocr_keys_en.txt",
            Language::Chinese => "models/ppocr_keys_v4.txt",
            Language::Arabic => "models/ppocr_keys_arabic.txt",
            Language::Cyrillic => "models/ppocr_keys_cyrillic.txt",
            Language::Devanagari => "models/ppocr_keys_devanagari.txt",
            Language::Greek => "models/ppocr_keys_el.txt",
            Language::EastSlavic => "models/ppocr_keys_eslav.txt",
            Language::Latin => "models/ppocr_keys_latin.txt",
            Language::Tamil => "models/ppocr_keys_ta.txt",
            Language::Telugu => "models/ppocr_keys_te.txt",
            Language::Thai => "models/ppocr_keys_th.txt",
            Language::Fallback => "models/ppocr_keys_v5.txt",
        }
    }
}

pub fn create_engine(
    language: Language,
    orientation: OrientationOptions,
) -> anyhow::Result<OcrEngine> {
    let det_options = DetOptions::default().with_max_side_len(1536);

    let mut builder = OcrEngineBuilder::new()
        .with_det_model_path("models/PP-OCRv5_server_det.mnn")
        .with_config(OcrEngineConfig::new().with_det_options(det_options))
        .with_rec_model_path(language.rec_model_path())
        .with_charset_path(language.charset_path());

    if orientation.use_doc_orientation_classify {
        builder = builder.with_ori_model_path("models/PP-LCNet_x1_0_doc_ori.mnn")
    }

    builder.build().map_err(Into::into)
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
