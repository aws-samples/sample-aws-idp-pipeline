use std::sync::Arc;

use arrow_schema::{DataType, Field, Schema, TimeUnit};

const VECTOR_DIMENSION: i32 = 1024;

pub fn document_record_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("workflow_id", DataType::Utf8, false),
        Field::new("document_id", DataType::Utf8, false),
        Field::new("segment_id", DataType::Utf8, false),
        Field::new("qa_id", DataType::Utf8, false),
        Field::new("segment_index", DataType::Int32, false),
        Field::new("qa_index", DataType::Int32, false),
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
