use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct GetSegmentsParams {
    pub project_id: String,
    pub workflow_id: String,
}

#[derive(Serialize)]
pub struct Segment {
    pub workflow_id: String,
    pub segment_id: String,
    pub qa_id: String,
    pub segment_index: u32,
    pub qa_index: u32,
    pub question: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct GetSegmentsOutput {
    pub success: bool,
    pub segments: Vec<Segment>,
}
