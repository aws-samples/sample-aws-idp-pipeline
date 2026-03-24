use arrow_array::RecordBatch;
use futures::TryStreamExt;
use lancedb::Connection;
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::db::model::{Keyword, GRAPH_KEYWORDS_TABLE};

pub const SELECT_COLUMNS: &[&str] = &["entity_id", "project_id", "name"];

#[derive(Deserialize)]
pub struct GetGraphKeywordsParams {
    pub project_id: String,
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub struct GetGraphKeywordsOutput {
    pub success: bool,
    pub keywords: Vec<Keyword>,
}

pub async fn execute(
    conn: &Connection,
    params: GetGraphKeywordsParams,
) -> lancedb::error::Result<GetGraphKeywordsOutput> {
    let table = conn.open_table(GRAPH_KEYWORDS_TABLE).execute().await?;
    let filter = format!("project_id = '{}'", params.project_id);
    let limit = params.limit.unwrap_or(50) as usize;

    info!("[get_graph_keywords] Querying project_id: {}", params.project_id);
    let batches: Vec<RecordBatch> = table
        .query()
        .only_if(filter)
        .select(Select::columns(SELECT_COLUMNS))
        .limit(limit)
        .execute()
        .await?
        .try_collect()
        .await?;

    let keywords: Vec<Keyword> = batches.iter().flat_map(Keyword::from_batch).collect();
    info!("[get_graph_keywords] Found {} keywords", keywords.len());

    Ok(GetGraphKeywordsOutput {
        success: true,
        keywords,
    })
}
