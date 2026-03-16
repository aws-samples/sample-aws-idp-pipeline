use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct DropTableParams {
    pub project_id: String,
}

#[derive(Serialize)]
pub struct DropTableOutput {
    pub success: bool,
}
