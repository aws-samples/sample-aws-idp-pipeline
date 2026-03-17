use lambda_runtime::{Error, LambdaEvent, service_fn};
use lancedb_service::LanceDbAction;
use lancedb_service::action::{count, list_tables};
use lancedb_service::db;
use tracing::info;

async fn handler(event: LambdaEvent<LanceDbAction>) -> Result<serde_json::Value, Error> {
    let (action, _context) = event.into_parts();

    info!("[handler] Connecting to LanceDB...");
    let conn = db::connect().await?;
    info!("[handler] Connected");

    let response = match action {
        LanceDbAction::ListTables => serde_json::to_value(list_tables::execute(&conn).await?)?,
        LanceDbAction::Count(params) => serde_json::to_value(count::execute(&conn, params).await?)?,
        _ => serde_json::json!({ "success": false, "error": "not implemented" }),
    };

    Ok(response)
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
