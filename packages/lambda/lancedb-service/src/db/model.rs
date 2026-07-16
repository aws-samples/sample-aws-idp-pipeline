use std::sync::Arc;

use arrow_array::RecordBatch;
use arrow_array::cast::AsArray;
use arrow_schema::{DataType, Field, Schema, TimeUnit};
use serde::Serialize;

const VECTOR_DIMENSION: i32 = 1024;

/// A segment is a chunked piece of a document record stored in LanceDB.
/// Each document is split into segments (with optional QA pairs),
/// and this struct represents a subset of fields used in query responses.
#[derive(Serialize)]
pub struct Segment {
    pub workflow_id: String,
    pub document_id: String,
    pub segment_id: String,
    pub qa_id: String,
    pub segment_index: i64,
    pub qa_index: i64,
    pub question: String,
    pub content: String,
}

impl Segment {
    pub fn from_batch(batch: &RecordBatch) -> Vec<Self> {
        let workflow_ids = batch.column_by_name("workflow_id").unwrap().as_string::<i32>();
        let document_ids = batch.column_by_name("document_id").unwrap().as_string::<i32>();
        let segment_ids = batch.column_by_name("segment_id").unwrap().as_string::<i32>();
        let qa_ids = batch.column_by_name("qa_id").unwrap().as_string::<i32>();
        let segment_indices = batch.column_by_name("segment_index").unwrap().as_primitive::<arrow_array::types::Int64Type>();
        let qa_indices = batch.column_by_name("qa_index").unwrap().as_primitive::<arrow_array::types::Int64Type>();
        let questions = batch.column_by_name("question").unwrap().as_string::<i32>();
        let contents = batch.column_by_name("content").unwrap().as_string::<i32>();

        (0..batch.num_rows())
            .map(|i| Segment {
                workflow_id: workflow_ids.value(i).to_string(),
                document_id: document_ids.value(i).to_string(),
                segment_id: segment_ids.value(i).to_string(),
                qa_id: qa_ids.value(i).to_string(),
                segment_index: segment_indices.value(i),
                qa_index: qa_indices.value(i),
                question: questions.value(i).to_string(),
                content: contents.value(i).to_string(),
            })
            .collect()
    }
}

#[derive(Serialize)]
pub struct ScoredSegment {
    #[serde(flatten)]
    pub segment: Segment,
    pub keywords: String,
    pub file_uri: String,
    pub score: f32,
}

impl ScoredSegment {
    pub fn from_batch(batch: &RecordBatch) -> Vec<Self> {
        let segments = Segment::from_batch(batch);
        let keywords_col = batch.column_by_name("keywords").unwrap().as_string::<i32>();
        let file_uris = batch.column_by_name("file_uri").unwrap().as_string::<i32>();
        let scores = batch.column_by_name("_relevance_score").unwrap().as_primitive::<arrow_array::types::Float32Type>();

        segments
            .into_iter()
            .enumerate()
            .map(|(i, segment)| ScoredSegment {
                segment,
                keywords: keywords_col.value(i).to_string(),
                file_uri: file_uris.value(i).to_string(),
                score: scores.value(i),
            })
            .collect()
    }
}

#[derive(Serialize)]
pub struct Keyword {
    pub entity_id: String,
    pub project_id: String,
    pub name: String,
}

impl Keyword {
    pub fn from_batch(batch: &RecordBatch) -> Vec<Self> {
        let entity_ids = batch.column_by_name("entity_id").unwrap().as_string::<i32>();
        let project_ids = batch.column_by_name("project_id").unwrap().as_string::<i32>();
        let names = batch.column_by_name("name").unwrap().as_string::<i32>();

        (0..batch.num_rows())
            .map(|i| Keyword {
                entity_id: entity_ids.value(i).to_string(),
                project_id: project_ids.value(i).to_string(),
                name: names.value(i).to_string(),
            })
            .collect()
    }
}

#[derive(Serialize)]
pub struct ScoredKeyword {
    #[serde(flatten)]
    pub keyword: Keyword,
    pub score: f32,
}

impl ScoredKeyword {
    pub fn from_batch(batch: &RecordBatch) -> Vec<Self> {
        let keywords = Keyword::from_batch(batch);
        let scores = batch.column_by_name("_relevance_score").unwrap().as_primitive::<arrow_array::types::Float32Type>();

        keywords
            .into_iter()
            .enumerate()
            .map(|(i, keyword)| ScoredKeyword {
                keyword,
                score: scores.value(i),
            })
            .collect()
    }
}

/// A structured-dataset catalog entry: one row per dataset (Excel sheet / CSV),
/// used to search for relevant datasets by name/description rather than listing
/// them all. Stored in a per-project table named "{project_id}_datasets".
#[derive(Serialize)]
pub struct Dataset {
    pub dataset_id: String,
    pub dataset_s3_uri: String,
    pub name: String,
    pub description: String,
    pub row_count: i64,
}

impl Dataset {
    pub fn from_batch(batch: &RecordBatch) -> Vec<Self> {
        let dataset_ids = batch.column_by_name("dataset_id").unwrap().as_string::<i32>();
        let uris = batch.column_by_name("dataset_s3_uri").unwrap().as_string::<i32>();
        let names = batch.column_by_name("name").unwrap().as_string::<i32>();
        let descriptions = batch.column_by_name("description").unwrap().as_string::<i32>();
        let row_counts = batch.column_by_name("row_count").unwrap().as_primitive::<arrow_array::types::Int64Type>();

        (0..batch.num_rows())
            .map(|i| Dataset {
                dataset_id: dataset_ids.value(i).to_string(),
                dataset_s3_uri: uris.value(i).to_string(),
                name: names.value(i).to_string(),
                description: descriptions.value(i).to_string(),
                row_count: row_counts.value(i),
            })
            .collect()
    }
}

#[derive(Serialize)]
pub struct ScoredDataset {
    #[serde(flatten)]
    pub dataset: Dataset,
    pub score: f32,
}

impl ScoredDataset {
    pub fn from_batch(batch: &RecordBatch) -> Vec<Self> {
        let datasets = Dataset::from_batch(batch);
        let scores = batch.column_by_name("_relevance_score").unwrap().as_primitive::<arrow_array::types::Float32Type>();

        datasets
            .into_iter()
            .enumerate()
            .map(|(i, dataset)| ScoredDataset {
                dataset,
                score: scores.value(i),
            })
            .collect()
    }
}

/// Per-project dataset-catalog table name: "{project_id}_datasets".
pub fn dataset_catalog_table(project_id: &str) -> String {
    format!("{project_id}_datasets")
}

/// Arrow schema for the dataset catalog. One row per dataset (Excel sheet / CSV).
/// `content` (name + description + column names) is embedded into `vector`, and
/// `keywords` backs the FTS index for hybrid search.
pub fn dataset_catalog_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("dataset_id", DataType::Utf8, false),
        Field::new("dataset_s3_uri", DataType::Utf8, false),
        Field::new("name", DataType::Utf8, false),
        Field::new("description", DataType::Utf8, false),
        Field::new("content", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                VECTOR_DIMENSION,
            ),
            false,
        ),
        Field::new("keywords", DataType::Utf8, false),
        Field::new("row_count", DataType::Int64, false),
    ]))
}

pub const GRAPH_KEYWORDS_TABLE: &str = "graph_keywords";

/// Arrow schema for the keywords table in LanceDB.
/// Each row represents a named entity extracted from documents.
/// Tables are partitioned by project_id.
pub fn keyword_record_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("entity_id", DataType::Utf8, false),
        Field::new("project_id", DataType::Utf8, false),
        Field::new("name", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                VECTOR_DIMENSION,
            ),
            false,
        ),
    ]))
}

/// Full Arrow schema for a document record in LanceDB.
/// A "document record" is the storage unit — one row per segment (or QA pair) of a document.
/// Tables are partitioned by project_id.
pub fn document_record_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("workflow_id", DataType::Utf8, false),
        Field::new("document_id", DataType::Utf8, false),
        Field::new("segment_id", DataType::Utf8, false),
        Field::new("qa_id", DataType::Utf8, false),
        Field::new("segment_index", DataType::Int64, false),
        Field::new("qa_index", DataType::Int64, false),
        Field::new("question", DataType::Utf8, false),
        Field::new("content", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(
                Arc::new(Field::new("item", DataType::Float32, true)),
                VECTOR_DIMENSION,
            ),
            false,
        ),
        Field::new("keywords", DataType::Utf8, false),
        Field::new("file_uri", DataType::Utf8, false),
        Field::new("file_type", DataType::Utf8, false),
        Field::new("image_uri", DataType::Utf8, true),
        Field::new("created_at", DataType::Timestamp(TimeUnit::Microsecond, None), false),
    ]))
}
