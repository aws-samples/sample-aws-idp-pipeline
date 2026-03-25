use lancedb::Connection;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db;
use crate::db::model::GRAPH_KEYWORDS_TABLE;

#[derive(Deserialize)]
pub struct DeleteGraphKeywordsByProjectIdParams {
    pub project_id: String,
}

#[derive(Serialize)]
pub struct DeleteGraphKeywordsByProjectIdOutput {
    pub success: bool,
}

pub async fn execute(
    conn: &Connection,
    params: DeleteGraphKeywordsByProjectIdParams,
) -> lancedb::error::Result<DeleteGraphKeywordsByProjectIdOutput> {
    let project_id = &params.project_id;

    info!("[delete_graph_keywords_by_project_id] Checking if table exists: {GRAPH_KEYWORDS_TABLE}");
    let table_names = db::table::list_tables(conn).await?;

    if !table_names.contains(&GRAPH_KEYWORDS_TABLE.to_string()) {
        info!("[delete_graph_keywords_by_project_id] Table not found: {GRAPH_KEYWORDS_TABLE}, skipping");
        return Ok(DeleteGraphKeywordsByProjectIdOutput { success: true });
    }

    info!("[delete_graph_keywords_by_project_id] Opening table: {GRAPH_KEYWORDS_TABLE}");
    let table = conn.open_table(GRAPH_KEYWORDS_TABLE).execute().await?;

    info!("[delete_graph_keywords_by_project_id] Deleting records with project_id = '{project_id}'");
    table.delete(&format!("project_id = '{project_id}'")).await?;

    info!("[delete_graph_keywords_by_project_id] Delete completed successfully");
    Ok(DeleteGraphKeywordsByProjectIdOutput { success: true })
}
