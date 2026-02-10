"""WebCrawler Consumer Lambda

Consumes SQS messages and invokes WebCrawler AgentCore Runtime.
"""
import json
import os

import boto3

WEBCRAWLER_AGENT_RUNTIME_ARN = os.environ.get('WEBCRAWLER_AGENT_RUNTIME_ARN', '')

agentcore_client = None


def get_agentcore_client():
    global agentcore_client
    if agentcore_client is None:
        agentcore_client = boto3.client(
            'bedrock-agentcore',
            region_name=os.environ.get('AWS_REGION', 'us-east-1'),
        )
    return agentcore_client


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    for record in event.get('Records', []):
        body = json.loads(record.get('body', '{}'))
        workflow_id = body.get('workflow_id', '')

        if not WEBCRAWLER_AGENT_RUNTIME_ARN:
            print('WEBCRAWLER_AGENT_RUNTIME_ARN not configured, skipping')
            continue

        client = get_agentcore_client()
        client.invoke_agent_runtime(
            agentRuntimeArn=WEBCRAWLER_AGENT_RUNTIME_ARN,
            payload=json.dumps(body).encode('utf-8'),
            contentType='application/json',
        )
        print(f'Invoked WebCrawler Agent: {workflow_id}')
