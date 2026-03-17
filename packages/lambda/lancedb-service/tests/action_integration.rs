use lancedb_service::action::{count, list_tables};
use lancedb_service::db;
use tracing::info;

fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_test_writer()
        .try_init();
}

#[tokio::test]
#[ignore]
async fn test_action_count() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let output = count::execute(
        &conn,
        count::CountParams {
            project_id: "keywords".to_string(),
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}

#[tokio::test]
#[ignore]
async fn test_action_list_tables() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let output = list_tables::execute(&conn).await.unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}
