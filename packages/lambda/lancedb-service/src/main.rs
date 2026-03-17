use lambda_runtime::{Error, LambdaEvent, service_fn};
use lancedb_service::LanceDbAction;
use lancedb_service::action::{count, get_by_segment_ids, get_segments, hybrid_search, list_tables};
use lancedb_service::db;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .without_time()
        .init();

    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let lambda_client = aws_sdk_lambda::Client::new(&aws_config);
    let bedrock_client = aws_sdk_bedrockruntime::Client::new(&aws_config);

    lambda_runtime::run(service_fn(|event: LambdaEvent<LanceDbAction>| {
        let lambda_client = &lambda_client;
        let bedrock_client = &bedrock_client;
        async move {
            handler(event, lambda_client, bedrock_client).await
        }
    }))
    .await
}

async fn handler(
    event: LambdaEvent<LanceDbAction>,
    lambda_client: &aws_sdk_lambda::Client,
    bedrock_client: &aws_sdk_bedrockruntime::Client,
) -> Result<serde_json::Value, Error> {
    let (action, _context) = event.into_parts();

    info!("[handler] Connecting to LanceDB...");
    let conn = db::connect().await?;
    info!("[handler] Connected");

    let response = match action {
        LanceDbAction::ListTables => serde_json::to_value(list_tables::execute(&conn).await?)?,
        LanceDbAction::Count(params) => serde_json::to_value(count::execute(&conn, params).await?)?,
        LanceDbAction::GetSegments(params) => serde_json::to_value(get_segments::execute(&conn, params).await?)?,
        LanceDbAction::GetBySegmentIds(params) => serde_json::to_value(get_by_segment_ids::execute(&conn, params).await?)?,
        LanceDbAction::HybridSearch(params) => serde_json::to_value(hybrid_search::execute(&conn, lambda_client, bedrock_client, params).await?)?,
        _ => serde_json::json!({ "success": false, "error": "not implemented" }),
    };

    Ok(response)
}
