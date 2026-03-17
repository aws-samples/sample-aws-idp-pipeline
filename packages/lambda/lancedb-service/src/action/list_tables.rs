use lancedb::Connection;
use serde::Serialize;

use crate::db;

#[derive(Serialize)]
pub struct ListTablesOutput {
    pub success: bool,
    pub tables: Vec<String>,
}

pub async fn execute(conn: &Connection) -> lancedb::error::Result<ListTablesOutput> {
    let tables = db::table::list_tables(conn).await?;
    Ok(ListTablesOutput {
        success: true,
        tables,
    })
}
