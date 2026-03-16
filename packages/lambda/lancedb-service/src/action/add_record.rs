use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct AddRecordParams {
    pub project_id: String,
    pub workflow_id: String,
    pub document_id: String,
    pub segment_index: u32,
    pub qa_index: Option<u32>,
    pub question: Option<String>,
    pub content_combined: String,
    pub language: Option<String>,
    pub file_uri: String,
    pub file_type: String,
    pub image_uri: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Serialize)]
pub struct AddRecordOutput {
    pub success: bool,
    pub segment_id: String,
    pub qa_id: String,
}
