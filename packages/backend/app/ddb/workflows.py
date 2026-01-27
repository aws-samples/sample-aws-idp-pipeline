from boto3.dynamodb.conditions import Key

from app.ddb.client import get_table
from app.ddb.models import DdbKey, Segment, Workflow


def make_workflow_key(document_id: str, workflow_id: str) -> DdbKey:
    return {"PK": f"DOC#{document_id}", "SK": f"WF#{workflow_id}"}


def get_workflow_item(document_id: str, workflow_id: str) -> Workflow | None:
    table = get_table()
    response = table.get_item(Key=make_workflow_key(document_id, workflow_id))
    item = response.get("Item")
    return Workflow(**item) if item else None


def query_workflows(document_id: str) -> list[Workflow]:
    """Query all workflows for a document."""
    table = get_table()
    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"DOC#{document_id}") & Key("SK").begins_with("WF#"),
    )
    return [Workflow(**item) for item in response.get("Items", [])]


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


def delete_workflow_item(document_id: str, workflow_id: str) -> int:
    """Delete workflow item and all related items (STEP, SEG#*, CONN#*, etc.)."""
    table = get_table()
    deleted_count = 0

    # Delete main workflow item under document
    table.delete_item(Key=make_workflow_key(document_id, workflow_id))
    deleted_count += 1

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
