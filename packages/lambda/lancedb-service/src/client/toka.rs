use std::env;

use aws_sdk_lambda::Client;
use aws_sdk_lambda::primitives::Blob;
use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Serialize)]
struct TokaRequest<'a> {
    text: &'a str,
    lang: &'a str,
}

#[derive(Deserialize)]
struct TokaResponse {
    tokens: Vec<String>,
}

pub async fn extract_keywords(client: &Client, text: &str, lang: &str) -> Result<String, aws_sdk_lambda::Error> {
    let function_name = env::var("TOKA_FUNCTION_NAME").expect("TOKA_FUNCTION_NAME is required");

    info!("[extract_keywords] Invoking toka lambda, lang: {lang}");
    let payload = serde_json::to_vec(&TokaRequest { text, lang }).unwrap();

    let response = client
        .invoke()
        .function_name(function_name)
        .payload(Blob::new(payload))
        .send()
        .await?;

    let result_payload = response.payload().unwrap().as_ref();
    let result: TokaResponse = serde_json::from_slice(result_payload).unwrap();
    info!("[extract_keywords] Got {} tokens", result.tokens.len());

    Ok(result.tokens.join(" "))
}
