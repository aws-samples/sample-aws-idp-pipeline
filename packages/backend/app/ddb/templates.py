from boto3.dynamodb.conditions import Key

from app.ddb.client import get_table
from app.ddb.models import DdbKey, Template


def make_template_key(template_id: str) -> DdbKey:
    return {"PK": f"TPL#{template_id}", "SK": "META"}


def query_templates() -> list[Template]:
    """Query all templates using GSI1 (global, newest first)."""
    table = get_table()
    response = table.query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq("TEMPLATES"),
        ScanIndexForward=False,
    )
    return [Template(**item) for item in response.get("Items", [])]


def get_template_item(template_id: str) -> Template | None:
    table = get_table()
    response = table.get_item(Key=make_template_key(template_id))
    item = response.get("Item")
    return Template(**item) if item else None
