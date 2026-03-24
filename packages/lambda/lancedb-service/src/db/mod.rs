pub mod model;
pub mod table;

use std::env;
use std::time::Duration;

use lancedb::Connection;

pub async fn connect() -> lancedb::error::Result<Connection> {
    let bucket =
        env::var("LANCEDB_EXPRESS_BUCKET_NAME").expect("LANCEDB_EXPRESS_BUCKET_NAME is required");
    let lock_table =
        env::var("LANCEDB_LOCK_TABLE_NAME").expect("LANCEDB_LOCK_TABLE_NAME is required");

    let uri = format!("s3+ddb://{bucket}?ddbTableName={lock_table}");

    lancedb::connect(&uri)
        .read_consistency_interval(Duration::ZERO)
        .execute()
        .await
}
