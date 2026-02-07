from decimal import Decimal
from typing import Any

from boto3.dynamodb.conditions import Key

from app.config import get_config
from app.ddb.client import get_ddb_resource, get_table
from app.ddb.models import DdbKey, Segment, Workflow


def _decimal_to_python(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: _decimal_to_python(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_decimal_to_python(i) for i in obj]
    return obj


def make_workflow_key(document_id: str, workflow_id: str, entity_type: str = "DOC") -> DdbKey:
    return {"PK": f"{entity_type}#{document_id}", "SK": f"WF#{workflow_id}"}


def get_workflow_item(document_id: str, workflow_id: str) -> Workflow | None:
    """Get workflow item (checks both DOC and WEB entities)."""
    table = get_table()

    # Try DOC#{document_id} first
    response = table.get_item(Key=make_workflow_key(document_id, workflow_id, "DOC"))
    item = response.get("Item")
    if item:
        return Workflow(**item)

    # Try WEB#{document_id}
    response = table.get_item(Key=make_workflow_key(document_id, workflow_id, "WEB"))
    item = response.get("Item")
    return Workflow(**item) if item else None


def query_workflows(document_id: str) -> list[Workflow]:
    """Query all workflows for a document (both DOC and WEB entities)."""
    table = get_table()
    workflows = []

    # Query DOC#{document_id}
    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"DOC#{document_id}") & Key("SK").begins_with("WF#"),
    )
    workflows.extend([Workflow(**item) for item in response.get("Items", [])])

    # Query WEB#{document_id}
    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"WEB#{document_id}") & Key("SK").begins_with("WF#"),
    )
    workflows.extend([Workflow(**item) for item in response.get("Items", [])])

    return workflows


def query_workflow_segments(workflow_id: str) -> list[Segment]:
    """Query all segments for a workflow."""
    table = get_table()
    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"WF#{workflow_id}") & Key("SK").begins_with("SEG#"),
    )
    return [Segment(**item) for item in response.get("Items", [])]


def update_workflow_status(
    document_id: str,
    workflow_id: str,
    status: str,
    execution_arn: str | None = None,
) -> None:
    """Update workflow status and optionally execution ARN."""
    from datetime import UTC, datetime

    table = get_table()
    update_expression = "SET #data.#status = :status, updated_at = :updated_at"
    expression_values: dict = {
        ":status": status,
        ":updated_at": datetime.now(UTC).isoformat(),
    }

    if execution_arn:
        update_expression += ", #data.execution_arn = :execution_arn"
        expression_values[":execution_arn"] = execution_arn

    table.update_item(
        Key=make_workflow_key(document_id, workflow_id),
        UpdateExpression=update_expression,
        ExpressionAttributeNames={"#data": "data", "#status": "status"},
        ExpressionAttributeValues=expression_values,
    )


def get_steps_batch(workflow_ids: list[str]) -> dict[str, dict]:
    """Batch-get STEP records for multiple workflows.

    Returns a dict mapping workflow_id to its step data dict.
    DynamoDB BatchGetItem supports up to 100 keys per call.
    """
    if not workflow_ids:
        return {}

    config = get_config()
    table_name = config.backend_table_name
    ddb = get_ddb_resource()

    result: dict[str, dict] = {}
    # BatchGetItem limit is 100 keys
    for i in range(0, len(workflow_ids), 100):
        batch = workflow_ids[i : i + 100]
        keys = [{"PK": f"WF#{wf_id}", "SK": "STEP"} for wf_id in batch]

        response = ddb.batch_get_item(
            RequestItems={table_name: {"Keys": keys}},
        )

        for item in response.get("Responses", {}).get(table_name, []):
            wf_id = item["PK"].replace("WF#", "", 1)
            result[wf_id] = _decimal_to_python(item.get("data", {}))

        # Handle unprocessed keys
        unprocessed = response.get("UnprocessedKeys", {})
        while unprocessed.get(table_name):
            response = ddb.batch_get_item(RequestItems=unprocessed)
            for item in response.get("Responses", {}).get(table_name, []):
                wf_id = item["PK"].replace("WF#", "", 1)
                result[wf_id] = _decimal_to_python(item.get("data", {}))
            unprocessed = response.get("UnprocessedKeys", {})

    return result


def delete_workflow_item(document_id: str, workflow_id: str) -> int:
    """Delete workflow item and all related items (STEP, SEG#*, CONN#*, etc.)."""
    table = get_table()
    deleted_count = 0

    # Delete main workflow item under document (try both DOC and WEB)
    for entity_type in ["DOC", "WEB"]:
        try:
            table.delete_item(Key=make_workflow_key(document_id, workflow_id, entity_type))
            deleted_count += 1
        except Exception:
            pass

    # Delete all items under WF#{workflow_id} (STEP, SEG#*, CONN#*, etc.)
    response = table.query(KeyConditionExpression=Key("PK").eq(f"WF#{workflow_id}"))
    items = response.get("Items", [])

    # Handle pagination
    last_key = response.get("LastEvaluatedKey")
    while last_key:
        response = table.query(
            KeyConditionExpression=Key("PK").eq(f"WF#{workflow_id}"),
            ExclusiveStartKey=last_key,
        )
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")

    # Batch delete all related items
    if items:
        with table.batch_writer() as batch:
            for item in items:
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
                deleted_count += 1

    return deleted_count
