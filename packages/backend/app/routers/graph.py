import json

import boto3
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import get_config

router = APIRouter(prefix="/projects/{project_id}/graph", tags=["graph"])

_lambda_client = None


def get_lambda_client():
    global _lambda_client
    if _lambda_client is None:
        config = get_config()
        _lambda_client = boto3.client("lambda", region_name=config.aws_region)
    return _lambda_client


def invoke_graph_service(action: str, params: dict) -> dict:
    config = get_config()
    if not config.graph_service_function_name:
        raise HTTPException(status_code=404, detail="Graph service not configured")

    client = get_lambda_client()
    resp = client.invoke(
        FunctionName=config.graph_service_function_name,
        InvocationType="RequestResponse",
        Payload=json.dumps({"action": action, "params": params}),
    )
    payload = json.loads(resp["Payload"].read())
    if resp.get("FunctionError") or payload.get("statusCode") != 200:
        raise HTTPException(
            status_code=500,
            detail=payload.get("error", "Graph service error"),
        )
    return payload


class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    properties: dict


class GraphEdge(BaseModel):
    source: str
    target: str
    label: str
    properties: dict | None = None


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


@router.get("")
def get_project_graph(
    project_id: str,
) -> GraphResponse:
    """Get project-level entity graph for visualization."""
    result = invoke_graph_service(
        "get_entity_graph",
        {"project_id": project_id},
    )
    return GraphResponse(
        nodes=[GraphNode(**n) for n in result.get("nodes", [])],
        edges=[GraphEdge(**e) for e in result.get("edges", [])],
    )


@router.get("/documents/{document_id}")
def get_document_graph(
    project_id: str,
    document_id: str,
) -> GraphResponse:
    """Get document-level graph (segments + entities) for visualization."""
    result = invoke_graph_service(
        "get_document_graph",
        {
            "project_id": project_id,
            "document_id": document_id,
        },
    )
    return GraphResponse(
        nodes=[GraphNode(**n) for n in result.get("nodes", [])],
        edges=[GraphEdge(**e) for e in result.get("edges", [])],
    )


class EntityDetail(BaseModel):
    id: str
    name: str
    type: str
    description: str | None = None
    aliases: list[str] | None = None
    neighbors: list[GraphNode] = []


@router.get("/entities/{entity_name}")
def get_entity_detail(
    project_id: str,
    entity_name: str,
    depth: int = Query(default=2, le=5),
) -> EntityDetail:
    """Get entity details with neighbors."""
    # Search for entity by name matching via graph traversal
    search_result = invoke_graph_service(
        "search_graph",
        {"project_id": project_id, "query": entity_name, "entity_limit": 1, "segment_limit": 0},
    )
    entities = search_result.get("entities", [])
    if not entities:
        raise HTTPException(status_code=404, detail="Entity not found")

    entity = entities[0]

    # Get neighbors via traversal
    traverse_result = invoke_graph_service(
        "traverse",
        {"start_id": entity["id"], "depth": depth, "limit": 50},
    )
    neighbors = [
        GraphNode(
            id=n.get("id", ""),
            label=n.get("props", {}).get("name", n.get("id", "")),
            type=(n.get("labels", ["unknown"])[0] if n.get("labels") else "unknown").lower(),
            properties=n.get("props", {}),
        )
        for n in traverse_result.get("nodes", [])
    ]

    return EntityDetail(
        id=entity["id"],
        name=entity["name"],
        type=entity["type"],
        description=entity.get("description"),
        aliases=entity.get("aliases"),
        neighbors=neighbors,
    )
