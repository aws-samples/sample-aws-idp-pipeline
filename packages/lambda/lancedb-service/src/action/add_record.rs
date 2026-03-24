use std::sync::Arc;

use arrow_array::{
    FixedSizeListArray, Float32Array, Int64Array, RecordBatch, StringArray,
    TimestampMicrosecondArray,
};
use arrow_schema::{DataType, Field};
use chrono::{DateTime, Utc};
use lancedb::Connection;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::client;
use crate::db;
use crate::db::model::document_record_schema;

#[derive(Deserialize)]
pub struct AddRecordParams {
    pub project_id: String,
    pub workflow_id: String,
    pub document_id: String,
    pub segment_index: u32,
    pub qa_index: Option<u32>,
    pub question: Option<String>,
    pub content_combined: String,
    pub language: Option<String>,
    pub file_uri: String,
    pub file_type: String,
    pub image_uri: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Serialize)]
pub struct AddRecordOutput {
    pub success: bool,
    pub segment_id: String,
    pub qa_id: String,
}

pub async fn execute(
    conn: &Connection,
    lambda_client: &aws_sdk_lambda::Client,
    bedrock_client: &aws_sdk_bedrockruntime::Client,
    params: AddRecordParams,
) -> Result<AddRecordOutput, Box<dyn std::error::Error + Send + Sync>> {
    let project_id = &params.project_id;
    let workflow_id = &params.workflow_id;
    let segment_index = params.segment_index;
    let qa_index = params.qa_index.unwrap_or(0);
    let question = params.question.as_deref().unwrap_or("");
    let content = &params.content_combined;
    let lang = params.language.as_deref().unwrap_or("ko");

    let segment_id = format!("{workflow_id}_{segment_index:04}");
    let qa_id = format!("{workflow_id}_{segment_index:04}_{qa_index:02}");

    info!("[add_record] project_id: {project_id}, qa_id: {qa_id}");

    // Get or create table
    info!("[add_record] Getting or creating table...");
    let table = db::table::get_or_create_table(conn, project_id, document_record_schema()).await?;

    // Extract keywords via Toka Lambda
    info!(
        "[add_record] Extracting keywords from content (len={}), lang={lang}",
        content.len()
    );
    let keywords = if content.is_empty() {
        String::new()
    } else {
        client::toka::extract_keywords(lambda_client, content, lang).await?
    };
    info!(
        "[add_record] Keywords: {}...",
        &keywords.chars().take(100).collect::<String>()
    );

    // Generate embedding via Bedrock
    info!("[add_record] Generating embedding...");
    let vector = client::bedrock::generate_embedding(bedrock_client, content).await?;

    // Parse created_at
    let created_at = if let Some(ref s) = params.created_at {
        s.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now())
    } else {
        Utc::now()
    };
    let created_at_micros = created_at.timestamp_micros();

    // Build Arrow RecordBatch
    let schema = document_record_schema();
    let values = Arc::new(Float32Array::from(vector)) as arrow_array::ArrayRef;
    let field = Arc::new(Field::new("item", DataType::Float32, true));
    let vector_array = FixedSizeListArray::new(field, 1024, values, None);

    let batch = RecordBatch::try_new(
        schema,
        vec![
            Arc::new(StringArray::from(vec![workflow_id.as_str()])),
            Arc::new(StringArray::from(vec![params.document_id.as_str()])),
            Arc::new(StringArray::from(vec![segment_id.as_str()])),
            Arc::new(StringArray::from(vec![qa_id.as_str()])),
            Arc::new(Int64Array::from(vec![segment_index as i64])),
            Arc::new(Int64Array::from(vec![qa_index as i64])),
            Arc::new(StringArray::from(vec![question])),
            Arc::new(StringArray::from(vec![content.as_str()])),
            Arc::new(vector_array),
            Arc::new(StringArray::from(vec![keywords.as_str()])),
            Arc::new(StringArray::from(vec![params.file_uri.as_str()])),
            Arc::new(StringArray::from(vec![params.file_type.as_str()])),
            Arc::new(StringArray::from(vec![params.image_uri.as_deref()])),
            Arc::new(TimestampMicrosecondArray::from(vec![created_at_micros])),
        ],
    )?;

    info!("[add_record] Adding record to table...");
    table.add(vec![batch]).execute().await?;

    info!("[add_record] Record added successfully: qa_id={qa_id}");
    Ok(AddRecordOutput {
        success: true,
        segment_id,
        qa_id,
    })
}
