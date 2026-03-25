pub mod action;
pub mod client;
pub mod db;

use action::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "action", content = "params")]
pub enum LanceDbAction {
    #[serde(rename = "add_graph_keywords")]
    AddGraphKeywords(add_graph_keywords::AddGraphKeywordsParams),

    #[serde(rename = "add_record")]
    AddRecord(add_record::AddRecordParams),

    #[serde(rename = "delete_record")]
    DeleteRecord(delete_record::DeleteRecordParams),

    #[serde(rename = "delete_by_workflow")]
    DeleteByWorkflow(delete_by_workflow::DeleteByWorkflowParams),

    #[serde(rename = "delete_graph_keywords_by_project_id")]
    DeleteGraphKeywordsByProjectId(delete_graph_keywords_by_project_id::DeleteGraphKeywordsByProjectIdParams),

    #[serde(rename = "get_graph_keywords")]
    GetGraphKeywords(get_graph_keywords::GetGraphKeywordsParams),

    #[serde(rename = "get_segments_by_document_id")]
    GetSegmentsByDocumentId(get_segments_by_document_id::GetSegmentsByDocumentIdParams),

    #[serde(rename = "get_by_segment_ids")]
    GetBySegmentIds(get_by_segment_ids::GetBySegmentIdsParams),

    #[serde(rename = "hybrid_search")]
    HybridSearch(hybrid_search::HybridSearchParams),

    #[serde(rename = "search_graph_keywords")]
    SearchGraphKeywords(search_graph_keywords::SearchGraphKeywordsParams),

    #[serde(rename = "list_tables")]
    ListTables,

    #[serde(rename = "count")]
    Count(count::CountParams),

    #[serde(rename = "drop_table")]
    DropTable(drop_table::DropTableParams),
}
