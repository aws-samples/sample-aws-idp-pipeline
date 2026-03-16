pub mod cjk;
pub mod icu;

use lambda_runtime::{Error, LambdaEvent, service_fn};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Request {
    text: String,
    lang: String,
}

#[derive(Serialize)]
struct Response {
    tokens: Vec<String>,
}

fn tokenize(text: &str, lang: &str) -> Vec<String> {
    match lang {
        "ko" | "ja" | "zh" => cjk::tokenize(text, lang),
        _ => icu::tokenize(text),
    }
}

async fn handler(event: LambdaEvent<Request>) -> Result<Response, Error> {
    let (request, _context) = event.into_parts();
    let tokens = tokenize(&request.text, &request.lang);
    Ok(Response { tokens })
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .without_time()
        .init();

    lambda_runtime::run(service_fn(handler)).await
}
