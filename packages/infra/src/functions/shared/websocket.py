import json
import os
from datetime import datetime, timezone
from typing import Optional

import boto3

from .ddb_client import get_connections

apigw_client = None
WEBSOCKET_API_ENDPOINT = os.environ.get('WEBSOCKET_API_ENDPOINT', '')


def get_apigw_client():
    global apigw_client
    if apigw_client is None and WEBSOCKET_API_ENDPOINT:
        apigw_client = boto3.client(
            'apigatewaymanagementapi',
            endpoint_url=WEBSOCKET_API_ENDPOINT,
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return apigw_client


class EventType:
    WORKFLOW_STARTED = 'WORKFLOW_STARTED'
    STEP_START = 'STEP_START'
    STEP_COMPLETE = 'STEP_COMPLETE'
    STEP_ERROR = 'STEP_ERROR'
    SEGMENT_PROGRESS = 'SEGMENT_PROGRESS'
    WORKFLOW_COMPLETE = 'WORKFLOW_COMPLETE'
    WORKFLOW_ERROR = 'WORKFLOW_ERROR'


def send_to_connection(connection_id: str, data: dict) -> bool:
    client = get_apigw_client()
    if not client:
        print('WebSocket API endpoint not configured')
        return False

    try:
        client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(data).encode('utf-8')
        )
        return True
    except client.exceptions.GoneException:
        print(f'Connection {connection_id} is gone')
        return False
    except Exception as e:
        print(f'Error sending to connection {connection_id}: {e}')
        return False


def broadcast_to_workflow(workflow_id: str, data: dict) -> int:
    connections = get_connections(workflow_id)
    success_count = 0

    for conn in connections:
        connection_id = conn.get('connection_id')
        if connection_id and send_to_connection(connection_id, data):
            success_count += 1

    return success_count


def notify_step_start(
    workflow_id: str,
    step_name: str,
    message: Optional[str] = None
) -> int:
    data = {
        'type': EventType.STEP_START,
        'workflow_id': workflow_id,
        'step': step_name,
        'message': message or f'{step_name} started',
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    return broadcast_to_workflow(workflow_id, data)


def notify_step_complete(
    workflow_id: str,
    step_name: str,
    message: Optional[str] = None,
    **kwargs
) -> int:
    data = {
        'type': EventType.STEP_COMPLETE,
        'workflow_id': workflow_id,
        'step': step_name,
        'message': message or f'{step_name} completed',
        'timestamp': datetime.now(timezone.utc).isoformat(),
        **kwargs
    }
    return broadcast_to_workflow(workflow_id, data)


def notify_step_error(
    workflow_id: str,
    step_name: str,
    error: str
) -> int:
    data = {
        'type': EventType.STEP_ERROR,
        'workflow_id': workflow_id,
        'step': step_name,
        'error': error,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    return broadcast_to_workflow(workflow_id, data)


def notify_segment_progress(
    workflow_id: str,
    completed: int,
    total: int
) -> int:
    data = {
        'type': EventType.SEGMENT_PROGRESS,
        'workflow_id': workflow_id,
        'completed': completed,
        'total': total,
        'percentage': round((completed / total) * 100, 1) if total > 0 else 0,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    return broadcast_to_workflow(workflow_id, data)


def notify_workflow_started(
    workflow_id: str,
    project_id: str,
    file_name: str
) -> int:
    data = {
        'type': EventType.WORKFLOW_STARTED,
        'workflow_id': workflow_id,
        'project_id': project_id,
        'file_name': file_name,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    return broadcast_to_workflow(workflow_id, data)


def notify_workflow_complete(
    workflow_id: str,
    summary: Optional[str] = None,
    segment_count: int = 0
) -> int:
    data = {
        'type': EventType.WORKFLOW_COMPLETE,
        'workflow_id': workflow_id,
        'segment_count': segment_count,
        'summary': summary,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    return broadcast_to_workflow(workflow_id, data)


def notify_workflow_error(
    workflow_id: str,
    error: str,
    step: Optional[str] = None
) -> int:
    data = {
        'type': EventType.WORKFLOW_ERROR,
        'workflow_id': workflow_id,
        'error': error,
        'step': step,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }
    return broadcast_to_workflow(workflow_id, data)
