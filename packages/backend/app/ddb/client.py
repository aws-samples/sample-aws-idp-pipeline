import secrets
import string
from datetime import UTC, datetime

import boto3

from app.config import get_config
from app.ddb.models import DdbKey

_ddb_resource = None
NANOID_ALPHABET = string.ascii_letters + string.digits + "_-"
NANOID_SIZE = 21


def get_ddb_resource():
    global _ddb_resource
    if _ddb_resource is None:
        _ddb_resource = boto3.resource("dynamodb")
    return _ddb_resource


def get_table():
    config = get_config()
    return get_ddb_resource().Table(config.backend_table_name)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def generate_nanoid(size: int = NANOID_SIZE) -> str:
    return "".join(secrets.choice(NANOID_ALPHABET) for _ in range(size))


def generate_project_id() -> str:
    return f"proj_{generate_nanoid()}"


def batch_delete_items(items: list[DdbKey]) -> None:
    """Batch delete items from DynamoDB."""
    table = get_table()
    with table.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
