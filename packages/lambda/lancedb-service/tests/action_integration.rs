use lancedb_service::action::{count, get_by_segment_ids, get_segments, list_tables};
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

#[tokio::test]
#[ignore]
async fn test_action_get_segments() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let output = get_segments::execute(
        &conn,
        get_segments::GetSegmentsParams {
            project_id: "proj_HLEpYD_QD5iT6VwptGxYJ".to_string(),
            workflow_id: "wf_adF_cHMvTcCFOdESChdyH".to_string(),
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}

#[tokio::test]
#[ignore]
async fn test_action_get_by_segment_ids() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let output = get_by_segment_ids::execute(
        &conn,
        get_by_segment_ids::GetBySegmentIdsParams {
            project_id: "proj_HLEpYD_QD5iT6VwptGxYJ".to_string(),
            segment_ids: vec!["wf_adF_cHMvTcCFOdESChdyH_0000".to_string()],
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}
