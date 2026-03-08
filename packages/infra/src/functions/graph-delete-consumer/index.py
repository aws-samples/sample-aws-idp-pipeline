"""Graph Delete Consumer Lambda

SQS consumer that deletes graph data from Neptune in batches.
Phases: analyses -> segments -> documents -> orphan_cleanup
Re-queues itself if more items remain.
"""
import json
import os
import urllib.parse
import urllib.request

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

NEPTUNE_ENDPOINT = os.environ.get('NEPTUNE_ENDPOINT', '')
NEPTUNE_PORT = os.environ.get('NEPTUNE_PORT', '8182')
GRAPH_DELETE_QUEUE_URL = os.environ.get('GRAPH_DELETE_QUEUE_URL', '')

_session = None
_sqs_client = None

PHASE_ORDER = ['analyses', 'segments', 'documents', 'orphan_cleanup']

DELETE_QUERIES = {
    'analyses': (
        'MATCH (a:Analysis {project_id: $pid, workflow_id: $wid}) '
        'WITH a LIMIT $batch DETACH DELETE a RETURN count(*) AS deleted'
    ),
    'segments': (
        'MATCH (s:Segment {project_id: $pid, workflow_id: $wid}) '
        'WITH s LIMIT $batch DETACH DELETE s RETURN count(*) AS deleted'
    ),
    'documents': (
        'MATCH (d:Document {project_id: $pid, workflow_id: $wid}) '
        'WITH d LIMIT $batch DETACH DELETE d RETURN count(*) AS deleted'
    ),
    'orphan_cleanup': (
        'MATCH (e:Entity {project_id: $pid}) '
        'WHERE NOT (e)-[:MENTIONED_IN]->() '
        'AND NOT (e)-[:RELATES_TO]-() '
        'AND NOT ()-[:RELATES_TO]->(e) '
        'WITH e LIMIT $batch DELETE e RETURN count(*) AS deleted'
    ),
}


def get_session():
    global _session
    if _session is None:
        _session = boto3.Session(
            region_name=os.environ.get('AWS_REGION', 'us-east-1'),
        )
    return _session


def get_sqs_client():
    global _sqs_client
    if _sqs_client is None:
        _sqs_client = boto3.client(
            'sqs', region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return _sqs_client


def run_query(query: str, parameters: dict = None) -> list:
    """Execute an openCypher query against Neptune DB Serverless via IAM-signed HTTPS."""
    session = get_session()
    credentials = session.get_credentials().get_frozen_credentials()
    region = session.region_name

    url = f'https://{NEPTUNE_ENDPOINT}:{NEPTUNE_PORT}/openCypher'
    body = {'query': query}
    if parameters:
        body['parameters'] = json.dumps(parameters)

    data = urllib.parse.urlencode(body).encode('utf-8')
    request = AWSRequest(
        method='POST',
        url=url,
        data=data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Host': f'{NEPTUNE_ENDPOINT}:{NEPTUNE_PORT}',
        },
    )
    SigV4Auth(credentials, 'neptune-db', region).add_auth(request)

    req = urllib.request.Request(
        url,
        data=data,
        headers=dict(request.headers),
        method='POST',
    )
    with urllib.request.urlopen(req) as resp:
        payload = json.loads(resp.read())

    return payload.get('results', [])


def send_to_queue(message: dict):
    """Send a message to the graph delete queue."""
    get_sqs_client().send_message(
        QueueUrl=GRAPH_DELETE_QUEUE_URL,
        MessageBody=json.dumps(message),
    )


def handler(event, _context):
    for record in event.get('Records', []):
        body = json.loads(record['body'])
        project_id = body['project_id']
        workflow_id = body['workflow_id']
        phase = body.get('phase', 'analyses')
        batch_size = body.get('batch_size', 500)
        if phase == 'orphan_cleanup':
            batch_size = min(batch_size, 100)

        print(f'Delete phase={phase} project={project_id} workflow={workflow_id} batch={batch_size}')

        query = DELETE_QUERIES[phase]
        params = {'pid': project_id, 'wid': workflow_id, 'batch': batch_size}

        results = run_query(query, params)
        deleted = results[0]['deleted'] if results else 0
        print(f'Deleted {deleted} {phase} nodes')

        if deleted >= batch_size:
            # More remain, re-queue same phase
            send_to_queue({
                'project_id': project_id,
                'workflow_id': workflow_id,
                'phase': phase,
                'batch_size': batch_size,
            })
            print(f'Re-queued phase={phase}')
        else:
            # Advance to next phase
            current_idx = PHASE_ORDER.index(phase)
            if current_idx < len(PHASE_ORDER) - 1:
                next_phase = PHASE_ORDER[current_idx + 1]
                send_to_queue({
                    'project_id': project_id,
                    'workflow_id': workflow_id,
                    'phase': next_phase,
                    'batch_size': batch_size,
                })
                print(f'Advanced to phase={next_phase}')
            else:
                print(f'Graph deletion complete for workflow={workflow_id}')
