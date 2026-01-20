import boto3
from pydantic import BaseModel

from config import get_config


class ProjectData(BaseModel):
    language: str = "en"


class ProjectItem(BaseModel):
    data: ProjectData


def get_project_language(project_id: str) -> str | None:
    """Get project language from DynamoDB."""
    config = get_config()
    if not config.backend_table_name:
        return None

    dynamodb = boto3.resource("dynamodb", region_name=config.aws_region)
    table = dynamodb.Table(config.backend_table_name)

    response = table.get_item(Key={"PK": f"PROJ#{project_id}", "SK": "META"})
    item = response.get("Item")
    if not item:
        return None

    project = ProjectItem.model_validate(item)
    return project.data.language
