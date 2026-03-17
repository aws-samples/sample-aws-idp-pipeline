use lancedb::Connection;
use serde::{Deserialize, Serialize};

use crate::db;

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

pub async fn execute(conn: &Connection, params: CountParams) -> lancedb::error::Result<CountOutput> {
    let (exists, count) = db::table::count(conn, &params.project_id).await?;
    Ok(CountOutput {
        success: true,
        project_id: params.project_id,
        count,
        exists,
    })
}
