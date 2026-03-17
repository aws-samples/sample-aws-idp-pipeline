pub mod action;
pub mod client;
pub mod db;

use action::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "action", content = "params")]
pub enum LanceDbAction {
    #[serde(rename = "add_record")]
    AddRecord(add_record::AddRecordParams),

    #[serde(rename = "delete_record")]
    DeleteRecord(delete_record::DeleteRecordParams),

    #[serde(rename = "delete_by_workflow")]
    DeleteByWorkflow(delete_by_workflow::DeleteByWorkflowParams),

    #[serde(rename = "get_segments")]
    GetSegments(get_segments::GetSegmentsParams),

    #[serde(rename = "get_by_segment_ids")]
    GetBySegmentIds(get_by_segment_ids::GetBySegmentIdsParams),

    #[serde(rename = "hybrid_search")]
    HybridSearch(hybrid_search::HybridSearchParams),

    #[serde(rename = "list_tables")]
    ListTables,

    #[serde(rename = "count")]
    Count(count::CountParams),

    #[serde(rename = "drop_table")]
    DropTable(drop_table::DropTableParams),
}
