import duckdb

from app.config import get_config


def get_duckdb_connection() -> duckdb.DuckDBPyConnection:
    """Get DuckDB connection with S3 httpfs configured."""
    config = get_config()

    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs;")
    conn.execute(f"SET s3_region='{config.aws_region}';")
    conn.execute("""
        CREATE OR REPLACE SECRET secret (
            TYPE s3,
            PROVIDER credential_chain
        );
    """)

    return conn
