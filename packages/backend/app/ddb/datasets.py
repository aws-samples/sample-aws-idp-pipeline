from boto3.dynamodb.conditions import Key

from app.ddb.client import get_table, now_iso
from app.ddb.models import Dataset, DatasetData, DdbKey


def make_dataset_key(project_id: str, dataset_id: str) -> DdbKey:
    return {"PK": f"PROJ#{project_id}", "SK": f"DATASET#{dataset_id}"}


def get_dataset_item(project_id: str, dataset_id: str) -> Dataset | None:
    table = get_table()
    response = table.get_item(Key=make_dataset_key(project_id, dataset_id))
    item = response.get("Item")
    return Dataset(**item) if item else None


def put_dataset_item(project_id: str, dataset_id: str, data: DatasetData) -> None:
    table = get_table()
    now = now_iso()
    item = {
        **make_dataset_key(project_id, dataset_id),
        "data": data.model_dump(),
        "created_at": now,
        "updated_at": now,
    }
    table.put_item(Item=item)


def query_datasets(project_id: str) -> list[Dataset]:
    """Query all datasets for a project (PK=PROJ#{id}, SK begins_with DATASET#)."""
    table = get_table()
    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJ#{project_id}") & Key("SK").begins_with("DATASET#"),
    )
    return [Dataset(**item) for item in response.get("Items", [])]


def delete_dataset_item(project_id: str, dataset_id: str) -> None:
    table = get_table()
    table.delete_item(Key=make_dataset_key(project_id, dataset_id))
