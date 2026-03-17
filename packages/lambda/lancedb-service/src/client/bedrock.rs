use aws_sdk_bedrockruntime::Client;
use aws_sdk_bedrockruntime::primitives::Blob;
use serde::{Deserialize, Serialize};
use tracing::info;

const DEFAULT_MODEL_ID: &str = "amazon.nova-2-multimodal-embeddings-v1:0";
const EMBEDDING_DIMENSION: usize = 1024;

#[derive(Serialize)]
struct EmbeddingRequest<'a> {
    #[serde(rename = "taskType")]
    task_type: &'a str,
    #[serde(rename = "singleEmbeddingParams")]
    single_embedding_params: SingleEmbeddingParams<'a>,
}

#[derive(Serialize)]
struct SingleEmbeddingParams<'a> {
    #[serde(rename = "embeddingPurpose")]
    embedding_purpose: &'a str,
    #[serde(rename = "embeddingDimension")]
    embedding_dimension: usize,
    text: TextParam<'a>,
}

#[derive(Serialize)]
struct TextParam<'a> {
    #[serde(rename = "truncationMode")]
    truncation_mode: &'a str,
    value: &'a str,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    embeddings: Vec<EmbeddingEntry>,
}

#[derive(Deserialize)]
struct EmbeddingEntry {
    embedding: Vec<f32>,
}

pub async fn generate_embedding(client: &Client, text: &str) -> Result<Vec<f32>, aws_sdk_bedrockruntime::Error> {
    let value = text.trim();
    if value.is_empty() {
        return Ok(vec![0.0; EMBEDDING_DIMENSION]);
    }

    info!("[generate_embedding] Invoking bedrock embedding, text length: {}", value.len());

    let request = EmbeddingRequest {
        task_type: "SINGLE_EMBEDDING",
        single_embedding_params: SingleEmbeddingParams {
            embedding_purpose: "GENERIC_INDEX",
            embedding_dimension: EMBEDDING_DIMENSION,
            text: TextParam {
                truncation_mode: "END",
                value,
            },
        },
    };

    let body = serde_json::to_vec(&request).unwrap();
    let response = client
        .invoke_model()
        .model_id(DEFAULT_MODEL_ID)
        .body(Blob::new(body))
        .content_type("application/json")
        .send()
        .await?;

    let result: EmbeddingResponse = serde_json::from_slice(response.body().as_ref()).unwrap();
    let embedding = result.embeddings.into_iter().next().unwrap().embedding;
    info!("[generate_embedding] Got embedding with {} dimensions", embedding.len());

    Ok(embedding)
}
