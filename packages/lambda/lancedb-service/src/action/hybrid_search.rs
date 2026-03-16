use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct HybridSearchParams {
    pub project_id: String,
    pub query: String,
    pub document_id: Option<String>,
    pub limit: Option<u32>,
    pub language: Option<String>,
}

#[derive(Serialize)]
pub struct HybridSearchResult {
    pub workflow_id: String,
    pub document_id: String,
    pub segment_id: String,
    pub qa_id: String,
    pub segment_index: u32,
    pub qa_index: u32,
    pub question: String,
    pub content: String,
    pub keywords: String,
    pub file_uri: String,
    pub score: f64,
}
