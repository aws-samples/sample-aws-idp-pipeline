use lambda_runtime::{Error, LambdaEvent, service_fn};
use lancedb_service::LanceDbAction;
use serde::Serialize;

#[derive(Serialize)]
struct Response {}

async fn handler(event: LambdaEvent<LanceDbAction>) -> Result<Response, Error> {
    let (_action, _context) = event.into_parts();
    Ok(Response {})
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
