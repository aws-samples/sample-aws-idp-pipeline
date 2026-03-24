use lancedb_service::action::{
    add_graph_keywords, add_record, count, delete_by_workflow, delete_record, drop_table,
    get_by_segment_ids, get_graph_keywords, get_segments, hybrid_search, list_tables,
    search_graph_keywords,
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
            project_id: "keywords".to_string(),
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}

#[tokio::test]
#[ignore]
async fn test_action_get_graph_keywords() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let output = get_graph_keywords::execute(
        &conn,
        get_graph_keywords::GetGraphKeywordsParams {
            project_id: "proj_test".to_string(),
            limit: Some(10),
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}

#[tokio::test]
#[ignore]
async fn test_action_search_graph_keywords() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let bedrock_client = aws_sdk_bedrockruntime::Client::new(&aws_config);
    let output = search_graph_keywords::execute(
        &conn,
        &bedrock_client,
        search_graph_keywords::SearchGraphKeywordsParams {
            project_id: "proj_test".to_string(),
            query: "떡볶이".to_string(),
            limit: Some(5),
        },
    )
    .await
    .unwrap();
    info!("output: {:?}", serde_json::to_value(&output).unwrap());
}

#[tokio::test]
#[ignore]
async fn test_action_add_graph_keywords() {
    init_tracing();
    dotenvy::dotenv().ok();
    let conn = db::connect().await.unwrap();
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let bedrock_client = aws_sdk_bedrockruntime::Client::new(&aws_config);
    let output = add_graph_keywords::execute(
        &conn,
        &bedrock_client,
        add_graph_keywords::AddGraphKeywordsParams {
            project_id: "proj_test".to_string(),
            keywords: vec![
                "떡볶이",
                "김치찌개",
                "불고기",
                "비빔밥",
                "잡채",
                "갈비탕",
                "삼겹살",
                "된장찌개",
                "순두부찌개",
                "냉면",
                "칼국수",
                "만두",
                "김밥",
                "떡국",
                "제육볶음",
                "닭갈비",
                "감자탕",
                "부대찌개",
                "해물파전",
                "잔치국수",
                "콩나물국",
                "미역국",
                "설렁탕",
                "육개장",
                "갈비찜",
                "족발",
                "보쌈",
                "치킨",
                "짜장면",
                "짬뽕",
                "탕수육",
                "볶음밥",
                "라면",
                "우동",
                "소바",
                "초밥",
                "회덮밥",
                "돈까스",
                "카레",
                "오므라이스",
                "파스타",
                "피자",
                "햄버거",
                "샌드위치",
                "스테이크",
                "샐러드",
                "수프",
                "리조또",
                "그라탕",
                "크로켓",
                "타코",
                "부리또",
                "나초",
                "퀘사디아",
                "엔칠라다",
                "팟타이",
                "쌀국수",
                "똠양꿍",
                "카오팟",
                "솜탐",
                "커리",
                "난",
                "탄두리치킨",
                "비리야니",
                "사모사",
                "딤섬",
                "마파두부",
                "깐풍기",
                "양장피",
                "유린기",
                "라멘",
                "규동",
                "오코노미야키",
                "타코야키",
                "야키소바",
                "훠궈",
                "마라탕",
                "딴딴면",
                "충칭소면",
                "꿔바로우",
                "케밥",
                "후무스",
                "팔라펠",
                "샤와르마",
                "바클라바",
                "크루아상",
                "바게트",
                "마카롱",
                "에클레어",
                "타르트",
                "티라미수",
                "판나코타",
                "젤라토",
                "카놀리",
                "브루스케타",
                "프레첼",
                "슈니첼",
                "브라트부르스트",
                "굴라쉬",
                "슈트루델",
            ]
            .into_iter()
            .map(String::from)
            .collect(),
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
