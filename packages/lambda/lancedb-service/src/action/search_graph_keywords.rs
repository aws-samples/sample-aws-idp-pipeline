use arrow_array::RecordBatch;
use futures::TryStreamExt;
use lance_index::scalar::FullTextSearchQuery;
use lancedb::Connection;
use lancedb::index::Index;
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::client;
use crate::db::model::{ScoredKeyword, GRAPH_KEYWORDS_TABLE};

use super::get_graph_keywords::SELECT_COLUMNS;

#[derive(Deserialize)]
pub struct SearchGraphKeywordsParams {
    pub project_id: String,
    pub query: String,
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub struct SearchGraphKeywordsOutput {
    pub success: bool,
    pub results: Vec<ScoredKeyword>,
}

pub async fn execute(
    conn: &Connection,
    bedrock_client: &aws_sdk_bedrockruntime::Client,
    params: SearchGraphKeywordsParams,
) -> lancedb::error::Result<SearchGraphKeywordsOutput> {
    let table = conn.open_table(GRAPH_KEYWORDS_TABLE).execute().await?;
    let filter = format!("project_id = '{}'", params.project_id);
    let limit = params.limit.unwrap_or(5) as usize;

    info!(
        "[search_graph_keywords] Hybrid search: {}, project_id: {}",
        params.query, params.project_id
    );

    table
        .create_index(&["name"], Index::FTS(Default::default()))
        .replace(true)
        .execute()
        .await?;

    let embedding = client::bedrock::generate_embedding(bedrock_client, &params.query)
        .await
        .map_err(|e| lancedb::error::Error::Runtime {
            message: format!("bedrock error: {e}"),
        })?;

    let batches: Vec<RecordBatch> = table
        .query()
        .full_text_search(FullTextSearchQuery::new(params.query))
        .only_if(filter)
        .select(Select::columns(SELECT_COLUMNS))
        .limit(limit)
        .nearest_to(embedding.as_slice())
        .map_err(|e| lancedb::error::Error::Runtime {
            message: format!("nearest_to error: {e}"),
        })?
        .execute()
        .await?
        .try_collect()
        .await?;

    let results: Vec<ScoredKeyword> = batches.iter().flat_map(ScoredKeyword::from_batch).collect();
    info!("[search_graph_keywords] Found {} results", results.len());

    Ok(SearchGraphKeywordsOutput {
        success: true,
        results,
    })
}
