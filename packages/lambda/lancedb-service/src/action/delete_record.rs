use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct DeleteRecordParams {
    pub project_id: String,
    pub workflow_id: String,
    pub segment_index: u32,
    pub qa_index: Option<u32>,
}

#[derive(Serialize)]
pub struct DeleteRecordOutput {
    pub success: bool,
    pub deleted: Option<u32>,
    pub segment_id: Option<String>,
    pub qa_id: Option<String>,
}
