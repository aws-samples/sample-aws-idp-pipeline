import json
import os

from shared.ddb_client import save_connection, delete_connection


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    route_key = event.get('requestContext', {}).get('routeKey')
    connection_id = event.get('requestContext', {}).get('connectionId')

    query_params = event.get('queryStringParameters') or {}
    workflow_id = query_params.get('workflow_id', '')

    if route_key == '$connect':
        return handle_connect(connection_id, workflow_id)
    elif route_key == '$disconnect':
        return handle_disconnect(connection_id, workflow_id)
    elif route_key == '$default':
        return handle_default(connection_id, event)
    else:
        return {'statusCode': 400, 'body': 'Unknown route'}


def handle_connect(connection_id: str, workflow_id: str):
    if not workflow_id:
        print(f'Connection {connection_id} rejected: missing workflow_id')
        return {'statusCode': 400, 'body': 'workflow_id is required'}

    try:
        save_connection(workflow_id, connection_id, ttl_seconds=7200)
        print(f'Connection {connection_id} saved for workflow {workflow_id}')
        return {'statusCode': 200, 'body': 'Connected'}
    except Exception as e:
        print(f'Error saving connection: {e}')
        return {'statusCode': 500, 'body': str(e)}


def handle_disconnect(connection_id: str, workflow_id: str):
    if not workflow_id:
        print(f'Disconnect without workflow_id for connection {connection_id}')
        return {'statusCode': 200, 'body': 'Disconnected'}

    try:
        delete_connection(workflow_id, connection_id)
        print(f'Connection {connection_id} deleted for workflow {workflow_id}')
        return {'statusCode': 200, 'body': 'Disconnected'}
    except Exception as e:
        print(f'Error deleting connection: {e}')
        return {'statusCode': 200, 'body': 'Disconnected'}


def handle_default(connection_id: str, event: dict):
    body = event.get('body', '{}')
    try:
        message = json.loads(body)
        print(f'Received message from {connection_id}: {message}')
    except json.JSONDecodeError:
        print(f'Invalid JSON from {connection_id}: {body}')

    return {'statusCode': 200, 'body': 'Message received'}
