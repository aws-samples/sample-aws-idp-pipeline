use std::sync::Arc;

use arrow_array::{FixedSizeListArray, Float32Array, Int64Array, RecordBatch, StringArray};
use arrow_schema::{DataType, Field};
use lancedb::Connection;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::client;
use crate::db;
use crate::db::model::{dataset_catalog_schema, dataset_catalog_table};

#[derive(Deserialize)]
pub struct AddDatasetParams {
    pub project_id: String,
    pub dataset_id: String,
    pub dataset_s3_uri: String,
    pub name: String,
    pub description: String,
    pub columns: Option<Vec<String>>,
    pub row_count: Option<i64>,
    pub language: Option<String>,
}

#[derive(Serialize)]
pub struct AddDatasetOutput {
    pub success: bool,
    pub dataset_id: String,
}

pub async fn execute(
    conn: &Connection,
    lambda_client: &aws_sdk_lambda::Client,
    bedrock_client: &aws_sdk_bedrockruntime::Client,
    params: AddDatasetParams,
) -> Result<AddDatasetOutput, Box<dyn std::error::Error + Send + Sync>> {
    let table_name = dataset_catalog_table(&params.project_id);
    let lang = params.language.as_deref().unwrap_or("ko");

    // Searchable text = name + description + column names. This is what a user's
    // question is matched against to find the right dataset.
    let columns = params.columns.unwrap_or_default();
    let content = format!(
        "{}\n{}\n{}",
        params.name,
        params.description,
        columns.join(", ")
    );

    info!(
        "[add_dataset] project_id: {}, dataset_id: {}, table: {table_name}",
        params.project_id, params.dataset_id
    );

    let table =
        db::table::get_or_create_table(conn, &table_name, dataset_catalog_schema()).await?;

    // Keywords for FTS (hybrid search), same Toka path as documents.
    let keywords = if content.is_empty() {
        String::new()
    } else {
        client::toka::extract_keywords(lambda_client, &content, lang).await?
    };

    // Embedding for vector search.
    let vector = client::bedrock::generate_embedding(bedrock_client, &content).await?;

    let schema = dataset_catalog_schema();
    let values = Arc::new(Float32Array::from(vector)) as arrow_array::ArrayRef;
    let field = Arc::new(Field::new("item", DataType::Float32, true));
    let vector_array = FixedSizeListArray::new(field, 1024, values, None);

    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(StringArray::from(vec![params.dataset_id.as_str()])),
            Arc::new(StringArray::from(vec![params.dataset_s3_uri.as_str()])),
            Arc::new(StringArray::from(vec![params.name.as_str()])),
            Arc::new(StringArray::from(vec![params.description.as_str()])),
            Arc::new(StringArray::from(vec![content.as_str()])),
            Arc::new(vector_array),
            Arc::new(StringArray::from(vec![keywords.as_str()])),
            Arc::new(Int64Array::from(vec![params.row_count.unwrap_or(0)])),
        ],
    )?;

    // A dataset is re-indexed on re-conversion; delete the old row first so the
    // catalog never accumulates stale duplicates for the same dataset_id.
    table
        .delete(&format!("dataset_id = '{}'", params.dataset_id))
        .await?;

    info!("[add_dataset] Adding record to table...");
    table.add(vec![batch]).execute().await?;

    info!("[add_dataset] Record added successfully: {}", params.dataset_id);
    Ok(AddDatasetOutput {
        success: true,
        dataset_id: params.dataset_id,
    })
}
