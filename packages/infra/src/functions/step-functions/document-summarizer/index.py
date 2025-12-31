import json
import os

import boto3

bedrock_client = None
lambda_client = None
LANCEDB_FUNCTION_NAME = os.environ.get('LANCEDB_FUNCTION_NAME', 'idp-v2-lancedb-service')


def get_bedrock_client():
    global bedrock_client
    if bedrock_client is None:
        bedrock_client = boto3.client(
            'bedrock-runtime',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return bedrock_client


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


def generate_summary(content: str, model_id: str) -> str:
    client = get_bedrock_client()

    prompt = f"""Summarize the following document analysis results in Korean.
Provide a structured summary with:
1. Document Overview (1-2 sentences)
2. Key Findings (3-5 bullet points)
3. Important Data Points
4. Conclusion

Document Analysis:
{content[:50000]}

Summary:"""

    try:
        response = client.invoke_model(
            modelId=model_id,
            body=json.dumps({
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 2048,
                'messages': [
                    {'role': 'user', 'content': prompt}
                ]
            }),
            contentType='application/json'
        )

        result = json.loads(response['body'].read())
        return result.get('content', [{}])[0].get('text', '')

    except Exception as e:
        print(f'Error generating summary: {e}')
        return f'Summary generation failed: {e}'


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    document_id = event.get('document_id')
    model_id = os.environ.get('SUMMARIZER_MODEL_ID', 'us.anthropic.claude-3-5-haiku-20241022-v1:0')

    try:
        result = invoke_lancedb('get_segments', {'document_id': document_id})

        if result.get('statusCode') != 200:
            raise Exception(result.get('error', 'Unknown error'))

        segments = result.get('segments', [])

        if not segments:
            print(f'No segments found for document {document_id}')
            return {
                'statusCode': 404,
                'document_id': document_id,
                'status': 'no_segments',
                'message': 'No segments found for summarization'
            }

        all_content = []
        for segment in segments:
            content = segment.get('content_combined', '')
            if content:
                all_content.append(f"### Page {segment.get('segment_index', 0) + 1}\n{content}")

        combined_content = '\n\n'.join(all_content)

        summary = generate_summary(combined_content, model_id)

        invoke_lancedb('update_status', {
            'document_id': document_id,
            'status': 'summarized'
        })

        print(f'Generated summary for document {document_id} with {len(segments)} segments')

        return {
            'statusCode': 200,
            'document_id': document_id,
            'status': 'completed',
            'segment_count': len(segments),
            'summary': summary,
            'summary_length': len(summary)
        }

    except Exception as e:
        print(f'Error in document summarization: {e}')
        return {
            'statusCode': 500,
            'document_id': document_id,
            'status': 'failed',
            'error': str(e)
        }
