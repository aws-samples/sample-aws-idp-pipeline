from boto3.dynamodb.conditions import Key

from app.ddb.client import get_table, now_iso
from app.ddb.models import DdbKey, Project, ProjectData


def make_project_key(project_id: str) -> DdbKey:
    return {"PK": f"PROJ#{project_id}", "SK": "META"}


def query_projects() -> list[Project]:
    """Query all projects using GSI1."""
    table = get_table()
    response = table.query(
        IndexName="GSI1",
        KeyConditionExpression=Key("GSI1PK").eq("PROJECTS"),
        ScanIndexForward=False,
    )
    return [Project(**item) for item in response.get("Items", [])]


def get_project_item(project_id: str) -> Project | None:
    table = get_table()
    response = table.get_item(Key=make_project_key(project_id))
    item = response.get("Item")
    return Project(**item) if item else None


def put_project_item(project_id: str, data: ProjectData) -> None:
    table = get_table()
    now = now_iso()
    item = {
        **make_project_key(project_id),
        "data": data.model_dump(),
        "created_at": now,
        "updated_at": now,
        "GSI1PK": "PROJECTS",
        "GSI1SK": now,
    }
    table.put_item(Item=item)


def update_project_data(project_id: str, data: ProjectData) -> None:
    table = get_table()
    now = now_iso()
    table.update_item(
        Key=make_project_key(project_id),
        UpdateExpression="SET #data = :data, updated_at = :updated_at, GSI1SK = :gsi1sk",
        ExpressionAttributeNames={"#data": "data"},
        ExpressionAttributeValues={":data": data.model_dump(), ":updated_at": now, ":gsi1sk": now},
    )


def query_all_project_items(project_id: str) -> list[DdbKey]:
    """Query all items under PROJ#{project_id} with pagination."""
    table = get_table()
    items: list[DdbKey] = []
    response = table.query(
        KeyConditionExpression=Key("PK").eq(f"PROJ#{project_id}"),
        ProjectionExpression="PK, SK",
    )
    items.extend(DdbKey(PK=str(item["PK"]), SK=str(item["SK"])) for item in response.get("Items", []))

    last_key = response.get("LastEvaluatedKey")
    while last_key:
        response = table.query(
            KeyConditionExpression=Key("PK").eq(f"PROJ#{project_id}"),
            ProjectionExpression="PK, SK",
            ExclusiveStartKey=last_key,
        )
        items.extend(DdbKey(PK=str(item["PK"]), SK=str(item["SK"])) for item in response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")

    return items
