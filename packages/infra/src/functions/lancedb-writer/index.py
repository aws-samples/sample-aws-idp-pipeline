import json
import os

import boto3

lambda_client = None
LANCEDB_FUNCTION_NAME = os.environ.get('LANCEDB_FUNCTION_NAME', 'idp-v2-lancedb-service')


def get_lambda_client():
    global lambda_client
    if lambda_client is None:
        lambda_client = boto3.client('lambda', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return lambda_client


def invoke_lancedb(action: str, params: dict) -> dict:
    client = get_lambda_client()
    response = client.invoke(
        FunctionName=LANCEDB_FUNCTION_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps({'action': action, 'params': params})
    )

    payload = response['Payload'].read().decode('utf-8')

    if 'FunctionError' in response:
        print(f'LanceDB Lambda error: {response["FunctionError"]}, payload: {payload}')
        return {'statusCode': 500, 'error': f'Lambda error: {payload}'}

    result = json.loads(payload)
    print(f'LanceDB response: {json.dumps(result)}')
    return result


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    for record in event.get('Records', []):
        try:
            message = json.loads(record['body'])
            print(f'Processing message: document_id={message.get("document_id")}, segment_id={message.get("segment_id")}')

            result = invoke_lancedb('add_record', {
                'document_id': message['document_id'],
                'segment_id': message['segment_id'],
                'segment_index': message.get('segment_index', 0),
                'status': message.get('status', 'completed'),
                'tools': message.get('tools', {}),
                'content_combined': message.get('content_combined', ''),
                'file_uri': message.get('file_uri', ''),
                'file_type': message.get('file_type', ''),
                'image_uri': message.get('image_uri')
            })

            if result.get('statusCode') != 200:
                raise Exception(result.get('error', 'Unknown error'))

            print(f'Saved segment {message["segment_id"]} to LanceDB')

        except Exception as e:
            print(f'Error processing message: {e}')
            raise

    return {'statusCode': 200, 'processed': len(event.get('Records', []))}
