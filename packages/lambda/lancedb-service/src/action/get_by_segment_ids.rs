use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct GetBySegmentIdsParams {
    pub project_id: String,
    pub segment_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct SegmentDetail {
    pub segment_id: String,
    pub qa_id: String,
    pub document_id: String,
    pub segment_index: u32,
    pub qa_index: u32,
    pub question: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct GetBySegmentIdsOutput {
    pub success: bool,
    pub segments: Vec<SegmentDetail>,
}
