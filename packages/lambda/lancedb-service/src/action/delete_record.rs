use lancedb::Connection;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db;

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

pub async fn execute(
    conn: &Connection,
    params: DeleteRecordParams,
) -> lancedb::error::Result<DeleteRecordOutput> {
    let project_id = &params.project_id;
    let workflow_id = &params.workflow_id;
    let segment_index = params.segment_index;

    info!("[delete_record] Checking if table exists: {project_id}");
    let table_names = db::table::list_tables(conn).await?;

    if !table_names.contains(&project_id.to_string()) {
        info!("[delete_record] Table not found: {project_id}, skipping");
        return Ok(DeleteRecordOutput {
            success: true,
            deleted: Some(0),
            segment_id: None,
            qa_id: None,
        });
    }

    let table = conn.open_table(project_id).execute().await?;

    if let Some(qa_index) = params.qa_index {
        let qa_id = format!("{workflow_id}_{segment_index:04}_{qa_index:02}");
        info!("[delete_record] Deleting record: qa_id={qa_id}");
        table.delete(&format!("qa_id = '{qa_id}'")).await?;
        Ok(DeleteRecordOutput {
            success: true,
            deleted: Some(1),
            segment_id: None,
            qa_id: Some(qa_id),
        })
    } else {
        let segment_id = format!("{workflow_id}_{segment_index:04}");
        info!("[delete_record] Deleting all records for segment_id={segment_id}");
        table.delete(&format!("segment_id = '{segment_id}'")).await?;
        Ok(DeleteRecordOutput {
            success: true,
            deleted: None,
            segment_id: Some(segment_id),
            qa_id: None,
        })
    }
}
