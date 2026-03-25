use arrow_array::RecordBatch;
use futures::TryStreamExt;
use lancedb::Connection;
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db::model::Segment;

#[derive(Deserialize)]
pub struct GetSegmentsByDocumentIdParams {
    pub project_id: String,
    pub document_id: String,
}

#[derive(Serialize)]
pub struct GetSegmentsByDocumentIdOutput {
    pub success: bool,
    pub segments: Vec<Segment>,
}

pub async fn execute(
    conn: &Connection,
    params: GetSegmentsByDocumentIdParams,
) -> lancedb::error::Result<GetSegmentsByDocumentIdOutput> {
    let table = conn.open_table(&params.project_id).execute().await?;

    info!("[get_segments_by_document_id] Querying document_id: {}", params.document_id);
    let filter = format!("document_id = '{}'", params.document_id);
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
    info!("[get_segments_by_document_id] Found {} segments", segments.len());

    Ok(GetSegmentsByDocumentIdOutput {
        success: true,
        segments,
    })
}
