use lancedb_service::client::toka;
use tracing::info;

fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_test_writer()
        .try_init();
}

#[tokio::test]
#[ignore]
async fn test_extract_keywords() {
    init_tracing();
    dotenvy::dotenv().ok();
    let config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let client = aws_sdk_lambda::Client::new(&config);
    let keywords = toka::extract_keywords(&client, "오늘 날씨가 좋습니다", "ko")
        .await
        .unwrap();
    info!("keywords: {keywords}");
}
