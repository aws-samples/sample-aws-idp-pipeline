import duckdb
from pydantic import BaseModel

from app.config import get_config


class Session(BaseModel):
    session_id: str
    session_type: str
    created_at: str
    updated_at: str
    session_name: str | None = None


class AgentListItem(BaseModel):
    agent_id: str
    name: str
    created_at: str


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


def query_agents(user_id: str, project_id: str) -> list[AgentListItem]:
    config = get_config()
    bucket_name = config.agent_storage_bucket_name

    if not bucket_name:
        return []

    s3_path = f"s3://{bucket_name}/{user_id}/{project_id}/agents/*.json"

    conn = get_duckdb_connection()
    try:
        result = conn.execute(f"""
            SELECT
                name,
                content,
                created_at,
                filename
            FROM read_json(
                '{s3_path}',
                columns={{
                    name: 'VARCHAR',
                    content: 'VARCHAR',
                    created_at: 'VARCHAR'
                }},
                filename=true
            )
            ORDER BY created_at DESC
        """).fetchall()
    except Exception:
        return []

    agents = []
    for row in result:
        filename = row[3]
        agent_id = filename.rsplit("/", 1)[-1].replace(".json", "")
        agents.append(
            AgentListItem(
                agent_id=agent_id,
                name=row[0] or agent_id,
                created_at=row[2] or "",
            )
        )

    return agents
