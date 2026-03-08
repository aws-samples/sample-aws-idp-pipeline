"""Graph Batch Sender Lambda

Called by Step Functions Map to send a single batch of graph data
(analyses, entities, or relationships) to graph-service.
Processes sequentially to avoid overwhelming Neptune.
"""
import json
import os
import time

import boto3

GRAPH_SERVICE_FUNCTION_NAME = os.environ.get('GRAPH_SERVICE_FUNCTION_NAME', '')

lambda_client = None


def get_lambda_client():
    global lambda_client
    if lambda_client is None:
        from botocore.config import Config
        lambda_client = boto3.client(
            'lambda',
            region_name=os.environ.get('AWS_REGION', 'us-east-1'),
            config=Config(read_timeout=300),
        )
    return lambda_client


def invoke_graph_service(action: str, params: dict, max_retries: int = 5) -> dict:
    """Invoke the GraphService Lambda with retry on 5xx errors."""
    client = get_lambda_client()
    for attempt in range(max_retries + 1):
        response = client.invoke(
            FunctionName=GRAPH_SERVICE_FUNCTION_NAME,
            InvocationType='RequestResponse',
            Payload=json.dumps({'action': action, 'params': params}),
        )
        payload = json.loads(response['Payload'].read())
        if response.get('FunctionError') or payload.get('statusCode') != 200:
            error_msg = payload.get('error', 'Unknown')
            if attempt < max_retries and ('500' in str(error_msg) or '503' in str(error_msg)):
                wait = 2 ** attempt
                print(f'{action} retry {attempt + 1}/{max_retries} after {wait}s: {error_msg}')
                time.sleep(wait)
                continue
            raise RuntimeError(f'GraphService error: {error_msg}')
        return payload
    raise RuntimeError(f'GraphService error: max retries exceeded for {action}')


def handler(event, _context):
    print(f'Event keys: {list(event.keys())}')

    action = event['action']
    s3_bucket = event['s3_bucket']
    s3_key = event['s3_key']
    extra_params = event.get('extra_params', {})
    batch_size = event.get('batch_size', 100)
    item_key = event['item_key']

    # Read data from S3
    s3 = boto3.client('s3')
    response = s3.get_object(Bucket=s3_bucket, Key=s3_key)
    items = json.loads(response['Body'].read())
    print(f'Loaded {len(items)} items from s3://{s3_bucket}/{s3_key}')

    # Send in batches sequentially
    total = len(items)
    sent = 0
    for i in range(0, total, batch_size):
        batch = items[i:i + batch_size]
        params = {**extra_params, item_key: batch}
        invoke_graph_service(action, params)
        sent += len(batch)
        if sent % 500 < batch_size or sent >= total:
            print(f'{action}: {sent}/{total}')

    print(f'Completed {action}: {sent} items')
    return {'action': action, 'sent': sent}
