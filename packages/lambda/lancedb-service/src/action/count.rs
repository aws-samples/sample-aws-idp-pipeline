use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct CountParams {
    pub project_id: String,
}

#[derive(Serialize)]
pub struct CountOutput {
    pub success: bool,
    pub project_id: String,
    pub count: u64,
    pub exists: bool,
}
