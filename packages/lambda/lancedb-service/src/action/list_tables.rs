use serde::Serialize;

#[derive(Serialize)]
pub struct ListTablesOutput {
    pub success: bool,
    pub tables: Vec<String>,
}
