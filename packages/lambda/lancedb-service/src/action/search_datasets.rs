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
use crate::db::model::{dataset_catalog_table, ScoredDataset};

#[derive(Deserialize)]
pub struct SearchDatasetsParams {
    pub project_id: String,
    pub query: String,
    pub limit: Option<u32>,
    pub language: Option<String>,
}

#[derive(Serialize)]
pub struct SearchDatasetsOutput {
    pub success: bool,
    pub results: Vec<ScoredDataset>,
}

pub async fn execute(
    conn: &Connection,
    lambda_client: &aws_sdk_lambda::Client,
    bedrock_client: &aws_sdk_bedrockruntime::Client,
    params: SearchDatasetsParams,
) -> lancedb::error::Result<SearchDatasetsOutput> {
    let table_name = dataset_catalog_table(&params.project_id);

    // No catalog yet for this project -> no datasets.
    let table_names = db::table::list_tables(conn).await?;
    if !table_names.contains(&table_name) {
        return Ok(SearchDatasetsOutput {
            success: true,
            results: vec![],
        });
    }

    let table = conn.open_table(&table_name).execute().await?;

    info!("[search_datasets] Creating FTS index on keywords...");
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

    info!("[search_datasets] Executing hybrid search, limit: {limit}");
    let batches: Vec<RecordBatch> = table
        .query()
        .full_text_search(fts_query)
        .select(Select::columns(&[
            "dataset_id",
            "dataset_s3_uri",
            "name",
            "description",
            "row_count",
        ]))
        .limit(limit)
        .nearest_to(embedding.as_slice())
        .map_err(|e| lancedb::error::Error::Runtime {
            message: format!("nearest_to error: {e}"),
        })?
        .execute()
        .await?
        .try_collect()
        .await?;

    let results: Vec<ScoredDataset> = batches.iter().flat_map(ScoredDataset::from_batch).collect();
    info!("[search_datasets] Found {} results", results.len());

    Ok(SearchDatasetsOutput {
        success: true,
        results,
    })
}
