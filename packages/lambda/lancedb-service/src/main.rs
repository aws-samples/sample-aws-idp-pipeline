use lambda_runtime::{Error, LambdaEvent, service_fn};
use lancedb_service::LanceDbAction;
use lancedb_service::action::{add_graph_keywords, add_record, count, delete_by_workflow, delete_record, drop_table, get_by_segment_ids, get_graph_keywords, get_segments, hybrid_search, list_tables, search_graph_keywords};
use lancedb_service::db;
use serde::Serialize;
use tracing::info;

/// Python Lambda 호환 응답 형식
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    status_code: u16,
    #[serde(flatten)]
    body: serde_json::Value,
}

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
) -> Result<Response, Error> {
    let (action, _context) = event.into_parts();

    info!("[handler] Connecting to LanceDB...");
    let conn = db::connect().await?;
    info!("[handler] Connected");

    let result: Result<serde_json::Value, (u16, String)> = match action {
        LanceDbAction::AddGraphKeywords(params) => add_graph_keywords::execute(&conn, bedrock_client, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::ListTables => list_tables::execute(&conn).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::Count(params) => count::execute(&conn, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::GetGraphKeywords(params) => get_graph_keywords::execute(&conn, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::GetSegments(params) => get_segments::execute(&conn, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::GetBySegmentIds(params) => get_by_segment_ids::execute(&conn, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::AddRecord(params) => add_record::execute(&conn, lambda_client, bedrock_client, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::SearchGraphKeywords(params) => search_graph_keywords::execute(&conn, bedrock_client, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::HybridSearch(params) => hybrid_search::execute(&conn, lambda_client, bedrock_client, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::DeleteRecord(params) => delete_record::execute(&conn, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::DeleteByWorkflow(params) => delete_by_workflow::execute(&conn, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        LanceDbAction::DropTable(params) => drop_table::execute(&conn, params).await
            .map_err(|e| (500, e.to_string()))
            .and_then(|v| serde_json::to_value(v).map_err(|e| (500, e.to_string()))),
        // All actions are now implemented
    };

    Ok(match result {
        Ok(body) => Response { status_code: 200, body },
        Err((code, error)) => Response {
            status_code: code,
            body: serde_json::json!({ "success": false, "error": error }),
        },
    })
}
