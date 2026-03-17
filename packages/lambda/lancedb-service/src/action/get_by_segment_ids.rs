use arrow_array::RecordBatch;
use futures::TryStreamExt;
use lancedb::Connection;
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db;
use crate::db::model::Segment;

#[derive(Deserialize)]
pub struct GetBySegmentIdsParams {
    pub project_id: String,
    pub segment_ids: Vec<String>,
}

#[derive(Serialize)]
pub struct GetBySegmentIdsOutput {
    pub success: bool,
    pub segments: Vec<Segment>,
}

pub async fn execute(
    conn: &Connection,
    params: GetBySegmentIdsParams,
) -> lancedb::error::Result<GetBySegmentIdsOutput> {
    if params.segment_ids.is_empty() {
        return Ok(GetBySegmentIdsOutput {
            success: true,
            segments: vec![],
        });
    }

    let table = db::document::get_or_create_table(conn, &params.project_id).await?;

    let id_list = params
        .segment_ids
        .iter()
        .map(|id| format!("'{id}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let filter = format!("segment_id IN ({id_list})");
    info!("[get_by_segment_ids] Querying {} segment_ids", params.segment_ids.len());

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
    info!("[get_by_segment_ids] Found {} segments", segments.len());

    Ok(GetBySegmentIdsOutput {
        success: true,
        segments,
    })
}
