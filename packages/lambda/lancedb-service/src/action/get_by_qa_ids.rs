use arrow_array::RecordBatch;
use futures::TryStreamExt;
use lancedb::Connection;
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db::model::Segment;

#[derive(Deserialize)]
pub struct GetByQaIdsParams {
    pub project_id: String,
    pub qa_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct GetByQaIdsOutput {
    pub success: bool,
    pub segments: Vec<Segment>,
}

pub async fn execute(
    conn: &Connection,
    params: GetByQaIdsParams,
) -> lancedb::error::Result<GetByQaIdsOutput> {
    if params.qa_ids.is_empty() {
        return Ok(GetByQaIdsOutput {
            success: true,
            segments: vec![],
        });
    }

    let table = conn.open_table(&params.project_id).execute().await?;

    let id_list = params
        .qa_ids
        .iter()
        .map(|id| format!("'{id}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let filter = format!("qa_id IN ({id_list})");
    info!("[get_by_qa_ids] Querying {} qa_ids", params.qa_ids.len());

    let batches: Vec<RecordBatch> = table
        .query()
        .only_if(filter)
        .select(Select::columns(&[
            "workflow_id",
            "document_id",
            "segment_id",
            "qa_id",
            "segment_index",
            "qa_index",
            "question",
            "content",
        ]))
        .execute()
        .await?
        .try_collect()
        .await?;

    let segments: Vec<Segment> = batches.iter().flat_map(Segment::from_batch).collect();
    info!("[get_by_qa_ids] Found {} segments", segments.len());

    Ok(GetByQaIdsOutput {
        success: true,
        segments,
    })
}
