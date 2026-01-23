from pydantic import BaseModel

from app.config import get_config
from app.duckdb import get_duckdb_connection


class Session(BaseModel):
    session_id: str
    session_type: str
    created_at: str
    updated_at: str
    session_name: str | None = None


def query_sessions(user_id: str, project_id: str) -> list[Session]:
    config = get_config()
    bucket_name = config.session_storage_bucket_name

    if not bucket_name:
        return []

    s3_path = f"s3://{bucket_name}/sessions/{user_id}/{project_id}/*/session.json"

    conn = get_duckdb_connection()
    try:
        result = conn.execute(f"""
            SELECT session_id, session_type, created_at, updated_at, session_name
            FROM read_json(
                '{s3_path}',
                columns={{
                    session_id: 'VARCHAR',
                    session_type: 'VARCHAR',
                    created_at: 'VARCHAR',
                    updated_at: 'VARCHAR',
                    session_name: 'VARCHAR'
                }}
            )
            ORDER BY created_at DESC, session_id DESC
        """).fetchall()
    except Exception:
        return []

    return [
        Session(
            session_id=row[0],
            session_type=row[1],
            created_at=row[2],
            updated_at=row[3],
            session_name=row[4],
        )
        for row in result
    ]
