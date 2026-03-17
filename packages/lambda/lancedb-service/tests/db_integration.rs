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
async fn test_connect() {
    init_tracing();
    dotenvy::dotenv().ok();
    let db = db::connect().await.unwrap();
    let tables = db::table::list_tables(&db).await.unwrap();
    info!("tables: {:?}", tables);
}

#[tokio::test]
#[ignore]
async fn test_get_or_create_table() {
    init_tracing();
    dotenvy::dotenv().ok();
    let db = db::connect().await.unwrap();
    let table = db::document::get_or_create_table(&db, "keywords")
        .await
        .unwrap();
    let count = table.count_rows(None).await.unwrap();
    info!("row count: {count}");
}

#[tokio::test]
#[ignore]
async fn test_count() {
    init_tracing();
    dotenvy::dotenv().ok();
    let db = db::connect().await.unwrap();
    let (exists, count) = db::table::count(&db, "keywords").await.unwrap();
    info!("exists: {exists}, count: {count}");
}
