from dataclasses import dataclass

from boto3.dynamodb.conditions import Key

from app.ddb.client import get_table
from app.ddb.models import Artifact


@dataclass
class PaginatedArtifacts:
    items: list[Artifact]
    next_cursor: str | None


def query_user_artifacts(
    user_id: str,
    limit: int = 20,
    next_cursor: str | None = None,
) -> PaginatedArtifacts:
    """Query all artifacts for a user with pagination."""
    table = get_table()

    query_params = {
        "IndexName": "GSI1",
        "KeyConditionExpression": Key("GSI1PK").eq(f"USR#{user_id}#ART"),
        "ScanIndexForward": False,
        "Limit": limit,
    }

    if next_cursor:
        import base64
        import json

        query_params["ExclusiveStartKey"] = json.loads(base64.b64decode(next_cursor))

    response = table.query(**query_params)

    items = [Artifact.model_validate(item) for item in response.get("Items", [])]

    result_next_cursor = None
    last_key = response.get("LastEvaluatedKey")
    if last_key:
        import base64
        import json

        result_next_cursor = base64.b64encode(json.dumps(last_key).encode()).decode()

    return PaginatedArtifacts(items=items, next_cursor=result_next_cursor)


def query_user_project_artifacts(
    user_id: str,
    project_id: str,
    limit: int = 20,
    next_cursor: str | None = None,
) -> PaginatedArtifacts:
    """Query all artifacts for a user in a specific project with pagination."""
    table = get_table()

    query_params = {
        "IndexName": "GSI2",
        "KeyConditionExpression": Key("GSI2PK").eq(f"USR#{user_id}#PROJ#{project_id}#ART"),
        "ScanIndexForward": False,
        "Limit": limit,
    }

    if next_cursor:
        import base64
        import json

        query_params["ExclusiveStartKey"] = json.loads(base64.b64decode(next_cursor))

    response = table.query(**query_params)

    items = [Artifact.model_validate(item) for item in response.get("Items", [])]

    result_next_cursor = None
    last_key = response.get("LastEvaluatedKey")
    if last_key:
        import base64
        import json

        result_next_cursor = base64.b64encode(json.dumps(last_key).encode()).decode()

    return PaginatedArtifacts(items=items, next_cursor=result_next_cursor)
