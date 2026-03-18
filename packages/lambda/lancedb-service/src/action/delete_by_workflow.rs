use lancedb::Connection;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db;

#[derive(Deserialize)]
pub struct DeleteByWorkflowParams {
    pub project_id: String,
    pub workflow_id: String,
}

#[derive(Serialize)]
pub struct DeleteByWorkflowOutput {
    pub success: bool,
}

pub async fn execute(
    conn: &Connection,
    params: DeleteByWorkflowParams,
) -> lancedb::error::Result<DeleteByWorkflowOutput> {
    let project_id = &params.project_id;
    let workflow_id = &params.workflow_id;

    info!("[delete_by_workflow] Checking if table exists: {project_id}");
    let table_names = db::table::list_tables(conn).await?;

    if !table_names.contains(&project_id.to_string()) {
        info!("[delete_by_workflow] Table not found: {project_id}, skipping");
        return Ok(DeleteByWorkflowOutput { success: true });
    }

    info!("[delete_by_workflow] Opening table: {project_id}");
    let table = conn.open_table(project_id).execute().await?;

    info!("[delete_by_workflow] Deleting records with workflow_id = '{workflow_id}'");
    table.delete(&format!("workflow_id = '{workflow_id}'")).await?;

    info!("[delete_by_workflow] Delete completed successfully");
    Ok(DeleteByWorkflowOutput { success: true })
}
