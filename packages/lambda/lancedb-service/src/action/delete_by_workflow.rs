use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct DeleteByWorkflowParams {
    pub project_id: String,
    pub workflow_id: String,
}

#[derive(Serialize)]
pub struct DeleteByWorkflowOutput {
    pub success: bool,
}
