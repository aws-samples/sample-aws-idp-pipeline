use std::collections::HashSet;
use std::sync::Arc;

use arrow_array::{FixedSizeListArray, Float32Array, RecordBatch, StringArray};
use arrow_schema::{DataType, Field};
use lancedb::Connection;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::client;
use crate::db;
use crate::db::model::{keyword_record_schema, GRAPH_KEYWORDS_TABLE};

use super::get_graph_keywords::{self, GetGraphKeywordsParams};

#[derive(Deserialize)]
pub struct AddGraphKeywordsParams {
    pub project_id: String,
    pub keywords: Vec<String>,
}

#[derive(Serialize)]
pub struct AddGraphKeywordsOutput {
    pub success: bool,
    pub count: usize,
}

pub async fn execute(
    conn: &Connection,
    bedrock_client: &aws_sdk_bedrockruntime::Client,
    params: AddGraphKeywordsParams,
) -> Result<AddGraphKeywordsOutput, Box<dyn std::error::Error + Send + Sync>> {
    info!("[add_graph_keywords] project_id: {}, count: {}", params.project_id, params.keywords.len());

    let table = db::table::get_or_create_table(conn, GRAPH_KEYWORDS_TABLE, keyword_record_schema()).await?;

    // 기존 키워드 조회하여 중복 필터링
    let existing = get_graph_keywords::execute(
        conn,
        GetGraphKeywordsParams {
            project_id: params.project_id.clone(),
            limit: Some(i64::MAX),
        },
    )
    .await?;

    let existing_names: HashSet<&str> = existing
        .keywords
        .iter()
        .map(|k| k.name.as_str())
        .collect();

    let new_keywords: Vec<String> = params
        .keywords
        .into_iter()
        .filter(|k| !existing_names.contains(k))
        .collect();

    let count = new_keywords.len();
    info!("[add_graph_keywords] {} new keywords after filtering {} existing", count, existing.keywords.len());

    if count == 0 {
        return Ok(AddGraphKeywordsOutput {
            success: true,
            count: 0,
        });
    }

    let mut entity_ids = Vec::with_capacity(count);
    let mut project_ids = Vec::with_capacity(count);
    let mut names = Vec::with_capacity(count);
    let mut all_embeddings: Vec<f32> = Vec::with_capacity(count * 1024);

    for chunk in new_keywords.chunks(10) {
        info!("[add_graph_keywords] Generating embeddings for chunk of {}", chunk.len());
        let futures: Vec<_> = chunk
            .iter()
            .map(|name| client::bedrock::generate_embedding(bedrock_client, name))
            .collect();
        let embeddings = futures::future::try_join_all(futures).await?;

        for (name, embedding) in chunk.iter().zip(embeddings) {
            entity_ids.push(format!("{}:{}", params.project_id, name));
            project_ids.push(params.project_id.clone());
            names.push(name.clone());
            all_embeddings.extend_from_slice(&embedding);
        }
    }

    let entity_ids_ref: Vec<&str> = entity_ids.iter().map(|s| s.as_str()).collect();
    let project_ids_ref: Vec<&str> = project_ids.iter().map(|s| s.as_str()).collect();
    let names_ref: Vec<&str> = names.iter().map(|s| s.as_str()).collect();

    let schema = keyword_record_schema();
    let values = Arc::new(Float32Array::from(all_embeddings)) as arrow_array::ArrayRef;
    let field = Arc::new(Field::new("item", DataType::Float32, true));
    let vector_array = FixedSizeListArray::new(field, 1024, values, None);

    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(StringArray::from(entity_ids_ref)),
            Arc::new(StringArray::from(project_ids_ref)),
            Arc::new(StringArray::from(names_ref)),
            Arc::new(vector_array),
        ],
    )?;

    info!("[add_graph_keywords] Adding {count} records to table...");
    table.add(vec![batch]).execute().await?;

    info!("[add_graph_keywords] Done");
    Ok(AddGraphKeywordsOutput {
        success: true,
        count,
    })
}
