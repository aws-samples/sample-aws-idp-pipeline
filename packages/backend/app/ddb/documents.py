from boto3.dynamodb.conditions import Key

from app.ddb.client import get_table, now_iso
from app.ddb.models import DdbKey, Document


def make_document_key(project_id: str, document_id: str) -> DdbKey:
    return {"PK": f"PROJ#{project_id}", "SK": f"DOC#{document_id}"}


def get_document_item(project_id: str, document_id: str) -> Document | None:
    table = get_table()
    response = table.get_item(Key=make_document_key(project_id, document_id))
    item = response.get("Item")
    return Document(**item) if item else None


def put_document_item(project_id: str, document_id: str, data: dict) -> None:
    table = get_table()
    now = now_iso()
    item = {
        **make_document_key(project_id, document_id),
        "GSI1PK": f"PROJ#{project_id}#DOC",
        "GSI1SK": now,
        "data": data,
        "created_at": now,
        "updated_at": now,
    }
    table.put_item(Item=item)


def update_document_data(project_id: str, document_id: str, data: dict) -> None:
    table = get_table()
    now = now_iso()
    table.update_item(
        Key=make_document_key(project_id, document_id),
        UpdateExpression="SET #data = :data, updated_at = :updated_at, GSI1SK = :gsi1sk",
        ExpressionAttributeNames={"#data": "data"},
        ExpressionAttributeValues={":data": data, ":updated_at": now, ":gsi1sk": now},
    )


def query_documents(project_id: str) -> list[Document]:
    """Query all documents for a project."""
    table = get_table()
    response = table.query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq(f"PROJ#{project_id}#DOC"),
        ScanIndexForward=False,
    )
    return [Document(**item) for item in response.get("Items", [])]


def delete_document_item(project_id: str, document_id: str) -> None:
    table = get_table()
    table.delete_item(Key=make_document_key(project_id, document_id))
