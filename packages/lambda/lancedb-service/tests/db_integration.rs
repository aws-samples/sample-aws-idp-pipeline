use futures::TryStreamExt;
use lancedb::query::{ExecutableQuery, QueryBase};
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
    let schema = db::model::keyword_record_schema();
    let table = db::table::get_or_create_table(&db, "graph_keywords", schema)
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

#[tokio::test]
#[ignore]
async fn test_inspect_schema() {
    init_tracing();
    dotenvy::dotenv().ok();
    let db = db::connect().await.unwrap();
    let table = db.open_table("keywords").execute().await.unwrap();
    let batches: Vec<_> = table
        .query()
        .limit(1)
        .execute()
        .await
        .unwrap()
        .try_collect()
        .await
        .unwrap();
    if let Some(batch) = batches.first() {
        for field in batch.schema().fields() {
            info!("field: {} -> {:?}", field.name(), field.data_type());
        }
    }
}
