use lancedb_service::action::{
    add_record, count, delete_by_workflow, delete_record, drop_table, get_by_segment_ids,
    get_segments, hybrid_search, list_tables,
};
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

#[tokio::test]
#[ignore]
async fn test_action_delete_record_by_qa() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let output = delete_record::execute(
        &conn,
        delete_record::DeleteRecordParams {
            project_id: "proj_HLEpYD_QD5iT6VwptGxYJ".to_string(),
            workflow_id: "wf_adF_cHMvTcCFOdESChdyH".to_string(),
            segment_index: 0,
            qa_index: Some(0),
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}

#[tokio::test]
#[ignore]
async fn test_action_delete_record_by_segment() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let output = delete_record::execute(
        &conn,
        delete_record::DeleteRecordParams {
            project_id: "proj_HLEpYD_QD5iT6VwptGxYJ".to_string(),
            workflow_id: "wf_adF_cHMvTcCFOdESChdyH".to_string(),
            segment_index: 0,
            qa_index: None,
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}

#[tokio::test]
#[ignore]
async fn test_action_delete_by_workflow() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let output = delete_by_workflow::execute(
        &conn,
        delete_by_workflow::DeleteByWorkflowParams {
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
async fn test_action_drop_table() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let output = drop_table::execute(
        &conn,
        drop_table::DropTableParams {
            project_id: "test".to_string(),
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}

#[tokio::test]
#[ignore]
async fn test_action_add_record() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let lambda_client = aws_sdk_lambda::Client::new(&aws_config);
    let bedrock_client = aws_sdk_bedrockruntime::Client::new(&aws_config);
    let output = add_record::execute(
        &conn,
        &lambda_client,
        &bedrock_client,
        add_record::AddRecordParams {
            project_id: "test".to_string(),
            workflow_id: "wf_test".to_string(),
            document_id: "doc_test".to_string(),
            segment_index: 0,
            qa_index: Some(0),
            question: Some("테스트 질문".to_string()),
            content_combined: "테스트 컨텐츠입니다.".to_string(),
            language: Some("ko".to_string()),
            file_uri: "s3://test/file.pdf".to_string(),
            file_type: "pdf".to_string(),
            image_uri: None,
            created_at: None,
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}

#[tokio::test]
#[ignore]
async fn test_action_hybrid_search() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let lambda_client = aws_sdk_lambda::Client::new(&aws_config);
    let bedrock_client = aws_sdk_bedrockruntime::Client::new(&aws_config);
    let output = hybrid_search::execute(
        &conn,
        &lambda_client,
        &bedrock_client,
        hybrid_search::HybridSearchParams {
            project_id: "proj_uPoA2GqP_PnnoL1gh7lNo".to_string(),
            query: "떡볶이 레시피".to_string(),
            document_id: None,
            limit: Some(5),
            language: Some("ko".to_string()),
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}
