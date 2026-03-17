use lancedb::{Connection, Table};
use tracing::info;

use super::model::document_record_schema;

pub async fn get_or_create_table(
    db: &Connection,
    project_id: &str,
) -> lancedb::error::Result<Table> {
    let table_name = project_id;

    info!("[get_or_create_table] Getting table names...");
    let table_names = db.table_names().execute().await?;
    info!(
        "[get_or_create_table] Existing tables: {:?}",
        table_names
    );

    if table_names.contains(&table_name.to_string()) {
        info!("[get_or_create_table] Opening existing table: {table_name}");
        db.open_table(table_name).execute().await
    } else {
        info!("[get_or_create_table] Creating new table: {table_name}");
        info!("[get_or_create_table] Getting document record schema...");
        let schema = document_record_schema();
        info!("[get_or_create_table] Schema ready, creating table...");
        let table = db.create_empty_table(table_name, schema).execute().await?;
        info!("[get_or_create_table] Table created successfully");
        Ok(table)
    }
}
