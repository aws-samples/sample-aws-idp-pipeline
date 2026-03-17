use arrow_array::RecordBatch;
use futures::TryStreamExt;
use lance_index::scalar::FullTextSearchQuery;
use lancedb::Connection;
use lancedb::index::Index;
use lancedb::query::{ExecutableQuery, QueryBase, Select};
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::client;
use crate::db;
use crate::db::model::ScoredSegment;

#[derive(Deserialize)]
pub struct HybridSearchParams {
    pub project_id: String,
    pub query: String,
    pub document_id: Option<String>,
    pub limit: Option<u32>,
    pub language: Option<String>,
}

#[derive(Serialize)]
pub struct HybridSearchOutput {
    pub success: bool,
    pub results: Vec<ScoredSegment>,
}

pub async fn execute(
    conn: &Connection,
    lambda_client: &aws_sdk_lambda::Client,
    bedrock_client: &aws_sdk_bedrockruntime::Client,
    params: HybridSearchParams,
) -> lancedb::error::Result<HybridSearchOutput> {
    let table_names = db::table::list_tables(conn).await?;
    if !table_names.contains(&params.project_id) {
        return Ok(HybridSearchOutput {
            success: true,
            results: vec![],
        });
    }

    let table = conn.open_table(&params.project_id).execute().await?;

    info!("[hybrid_search] Creating FTS index on keywords...");
    table
        .create_index(&["keywords"], Index::FTS(Default::default()))
        .replace(true)
        .execute()
        .await?;

    let lang = params.language.as_deref().unwrap_or("ko");
    let keywords = client::toka::extract_keywords(lambda_client, &params.query, lang)
        .await
        .map_err(|e| lancedb::error::Error::Runtime {
            message: format!("toka error: {e}"),
        })?;

    let embedding = client::bedrock::generate_embedding(bedrock_client, &params.query)
        .await
        .map_err(|e| lancedb::error::Error::Runtime {
            message: format!("bedrock error: {e}"),
        })?;

    let limit = params.limit.unwrap_or(10) as usize;
    let fts_query = FullTextSearchQuery::new(keywords);

    info!("[hybrid_search] Executing hybrid search, limit: {limit}");
    let mut query = table
        .query()
        .full_text_search(fts_query)
        .select(Select::columns(&[
            "workflow_id",
            "document_id",
            "segment_id",
            "qa_id",
            "segment_index",
            "qa_index",
            "question",
            "content",
            "keywords",
            "file_uri",
        ]))
        .limit(limit)
        .nearest_to(embedding.as_slice())
        .map_err(|e| lancedb::error::Error::Runtime {
            message: format!("nearest_to error: {e}"),
        })?;

    if let Some(doc_id) = &params.document_id {
        query = query.only_if(format!("document_id = '{doc_id}'"));
    }

    let batches: Vec<RecordBatch> = query.execute().await?.try_collect().await?;
    let results: Vec<ScoredSegment> = batches.iter().flat_map(ScoredSegment::from_batch).collect();
    info!("[hybrid_search] Found {} results", results.len());

    Ok(HybridSearchOutput {
        success: true,
        results,
    })
}
