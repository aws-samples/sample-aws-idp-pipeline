import json
from typing import Any

import boto3
from pydantic import BaseModel

from app.config import get_config

_lambda_client = None


def get_lambda_client():
    global _lambda_client
    if _lambda_client is None:
        config = get_config()
        _lambda_client = boto3.client("lambda", region_name=config.aws_region)
    return _lambda_client


def invoke_lancedb(action: str, params: dict[str, Any]) -> dict[str, Any]:
    config = get_config()
    client = get_lambda_client()
    resp = client.invoke(
        FunctionName=config.lancedb_function_name,
        InvocationType="RequestResponse",
        Payload=json.dumps({"action": action, "params": params}),
    )
    payload = json.loads(resp["Payload"].read())
    if resp.get("FunctionError") or payload.get("statusCode") != 200:
        raise LanceDbError(payload.get("error", "LanceDB service error"))
    return payload


class LanceDbError(Exception):
    pass


# --- drop_table ---


class DropTableInput(BaseModel):
    project_id: str


class DropTableOutput(BaseModel):
    success: bool


def drop_table(params: DropTableInput) -> DropTableOutput:
    result = invoke_lancedb("drop_table", params.model_dump())
    return DropTableOutput(**result)


# --- delete_by_workflow ---


class DeleteByWorkflowInput(BaseModel):
    project_id: str
    workflow_id: str


class DeleteByWorkflowOutput(BaseModel):
    success: bool


def delete_by_workflow(params: DeleteByWorkflowInput) -> DeleteByWorkflowOutput:
    result = invoke_lancedb("delete_by_workflow", params.model_dump())
    return DeleteByWorkflowOutput(**result)


# --- delete_graph_keywords_by_project_id ---


class DeleteGraphKeywordsByProjectIdInput(BaseModel):
    project_id: str


class DeleteGraphKeywordsByProjectIdOutput(BaseModel):
    success: bool


def delete_graph_keywords_by_project_id(
    params: DeleteGraphKeywordsByProjectIdInput,
) -> DeleteGraphKeywordsByProjectIdOutput:
    result = invoke_lancedb("delete_graph_keywords_by_project_id", params.model_dump())
    return DeleteGraphKeywordsByProjectIdOutput(**result)
