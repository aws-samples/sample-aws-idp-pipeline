use lancedb::Connection;
use tracing::info;

use super::model::document_record_schema;

pub async fn list_tables(db: &Connection) -> lancedb::error::Result<Vec<String>> {
    info!("[list_tables] Getting table names...");
    let table_names = db.table_names().execute().await?;
    info!("[list_tables] Found {} tables", table_names.len());
    Ok(table_names)
}

pub async fn drop_table(db: &Connection, project_id: &str) -> lancedb::error::Result<()> {
    info!("[drop_table] Dropping table: {project_id}");
    db.drop_table(project_id, &[]).await?;
    info!("[drop_table] Table dropped successfully");
    Ok(())
}

pub async fn count(db: &Connection, project_id: &str) -> lancedb::error::Result<(bool, u64)> {
    info!("[count] Getting table names...");
    let table_names = db.table_names().execute().await?;

    if !table_names.contains(&project_id.to_string()) {
        info!("[count] Table not found: {project_id}");
        return Ok((false, 0));
    }

    info!("[count] Opening table: {project_id}");
    let table = db.open_table(project_id).execute().await?;
    let count = table.count_rows(None).await?;
    info!("[count] Table {project_id} has {count} rows");
    Ok((true, count as u64))
}

pub async fn create_table(db: &Connection, project_id: &str) -> lancedb::error::Result<()> {
    info!("[create_table] Creating table: {project_id}");
    let schema = document_record_schema();
    db.create_empty_table(project_id, schema).execute().await?;
    info!("[create_table] Table created successfully");
    Ok(())
}
