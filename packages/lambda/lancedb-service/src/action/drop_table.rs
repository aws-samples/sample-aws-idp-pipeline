use lancedb::Connection;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db;

#[derive(Deserialize)]
pub struct DropTableParams {
    pub project_id: String,
}

#[derive(Serialize)]
pub struct DropTableOutput {
    pub success: bool,
}

pub async fn execute(
    conn: &Connection,
    params: DropTableParams,
) -> lancedb::error::Result<DropTableOutput> {
    let project_id = &params.project_id;

    info!("[drop_table] Checking if table exists: {project_id}");
    let table_names = db::table::list_tables(conn).await?;

    if !table_names.contains(&project_id.to_string()) {
        info!("[drop_table] Table not found: {project_id}, skipping");
        return Ok(DropTableOutput { success: true });
    }

    info!("[drop_table] Dropping table: {project_id}");
    db::table::drop_table(conn, project_id).await?;

    Ok(DropTableOutput { success: true })
}
