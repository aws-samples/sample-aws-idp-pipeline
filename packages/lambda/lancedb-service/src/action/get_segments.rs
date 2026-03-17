use arrow_array::RecordBatch;
use futures::TryStreamExt;
use lancedb::Connection;
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db;
use crate::db::model::Segment;

#[derive(Deserialize)]
pub struct GetSegmentsParams {
    pub project_id: String,
    pub workflow_id: String,
}

#[derive(Serialize)]
pub struct GetSegmentsOutput {
    pub success: bool,
    pub segments: Vec<Segment>,
}

pub async fn execute(
    conn: &Connection,
    params: GetSegmentsParams,
) -> lancedb::error::Result<GetSegmentsOutput> {
    let table = db::document::get_or_create_table(conn, &params.project_id).await?;

    info!("[get_segments] Querying workflow_id: {}", params.workflow_id);
    let filter = format!("workflow_id = '{}'", params.workflow_id);
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

    let mut segments: Vec<Segment> = batches.iter().flat_map(Segment::from_batch).collect();
    segments.sort_by_key(|s| s.segment_index);
    info!("[get_segments] Found {} segments", segments.len());

    Ok(GetSegmentsOutput {
        success: true,
        segments,
    })
}
