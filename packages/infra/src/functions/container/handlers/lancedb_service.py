import json
import os
from datetime import datetime, timezone
from typing import Optional

import boto3
import lancedb
from lancedb.pydantic import LanceModel, Vector
from lancedb.embeddings import TextEmbeddingFunction, register
from pydantic import PrivateAttr
from kiwipiepy import Kiwi

LANCEDB_EXPRESS_BUCKET_SSM_KEY = '/idp-v2/lancedb/express/bucket-name'

_db_connections = {}
_table_name = 'documents'
_kiwi = None
_bucket_name = None


def get_ssm_parameter(key: str) -> str:
    ssm = boto3.client('ssm', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    response = ssm.get_parameter(Name=key)
    return response['Parameter']['Value']


def get_bucket_name():
    global _bucket_name
    if _bucket_name is None:
        _bucket_name = get_ssm_parameter(LANCEDB_EXPRESS_BUCKET_SSM_KEY)
    return _bucket_name


def get_lancedb_connection(project_id: str):
    global _db_connections
    if project_id not in _db_connections:
        bucket_name = get_bucket_name()
        _db_connections[project_id] = lancedb.connect(f's3://{bucket_name}/{project_id}.lance')
    return _db_connections[project_id]


def get_kiwi():
    global _kiwi
    if _kiwi is None:
        _kiwi = Kiwi()
    return _kiwi


def extract_keywords(text: str) -> str:
    kiwi = get_kiwi()
    results = []
    tokens = kiwi.tokenize(text, normalize_coda=True)

    for token in tokens:
        if token.tag == 'XSN':
            if results:
                results[-1] += token.form
            continue

        if token.tag in ['NNG', 'NNP', 'NR', 'NP', 'SL', 'SN', 'SH']:
            if token.tag not in ['SL', 'SN', 'SH'] and len(token.form) == 1:
                if token.form in ['것', '수', '등', '때', '곳']:
                    continue
            results.append(token.form)

    return ' '.join(results)


@register('bedrock-nova')
class BedrockEmbeddingFunction(TextEmbeddingFunction):
    model_id: str = 'amazon.nova-embed-image-v1:0'
    region_name: str = 'us-east-1'
    _client: object = PrivateAttr()
    _ndims: int = PrivateAttr()

    def __init__(self, **data):
        super().__init__(**data)
        self._client = boto3.client(
            'bedrock-runtime',
            region_name=data.get('region_name', os.environ.get('AWS_REGION', 'us-east-1'))
        )
        self._ndims = 1024

    def ndims(self) -> int:
        return self._ndims

    def generate_embeddings(self, texts):
        embeddings = []
        for text in texts:
            try:
                response = self._client.invoke_model(
                    modelId=self.model_id,
                    body=json.dumps({'inputText': text[:10000]}),
                    contentType='application/json'
                )
                result = json.loads(response['body'].read())
                embeddings.append(result.get('embedding', [0.0] * self._ndims))
            except Exception as e:
                print(f'Error generating embedding: {e}')
                embeddings.append([0.0] * self._ndims)
        return embeddings


bedrock_embeddings = BedrockEmbeddingFunction.create()


class DocumentRecord(LanceModel):
    workflow_id: str
    segment_id: str
    segment_index: int
    content: str = bedrock_embeddings.SourceField()
    vector: Vector(1024) = bedrock_embeddings.VectorField()
    keywords: str
    file_uri: str
    file_type: str
    image_uri: Optional[str] = None
    created_at: datetime


def get_or_create_table(project_id: str):
    db = get_lancedb_connection(project_id)
    table_names = db.table_names()
    if _table_name in table_names:
        return db.open_table(_table_name)
    else:
        table = db.create_table(_table_name, schema=DocumentRecord)
        table.create_fts_index('keywords', replace=True)
        return table


def action_add_record(params: dict) -> dict:
    project_id = params.get('project_id', 'default')
    table = get_or_create_table(project_id)

    workflow_id = params.get('workflow_id', '')
    segment_index = params.get('segment_index', 0)
    segment_id = f'{workflow_id}_{segment_index:04d}'
    content = params.get('content_combined', '')
    keywords = extract_keywords(content) if content else ''
    created_at_str = params.get('created_at', '')

    if created_at_str:
        created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
    else:
        created_at = datetime.now(timezone.utc)

    record = {
        'workflow_id': workflow_id,
        'segment_id': segment_id,
        'segment_index': segment_index,
        'content': content[:10000],
        'keywords': keywords,
        'file_uri': params.get('file_uri', ''),
        'file_type': params.get('file_type', ''),
        'image_uri': params.get('image_uri'),
        'created_at': created_at
    }

    table.add([record])
    return {'success': True, 'segment_id': segment_id}


def action_get_segments(params: dict) -> dict:
    project_id = params.get('project_id', 'default')
    table = get_or_create_table(project_id)
    workflow_id = params['workflow_id']
    results = table.search().where(f"workflow_id = '{workflow_id}'").to_list()
    results = sorted(results, key=lambda x: x.get('segment_index', 0))

    segments = []
    for r in results:
        segments.append({
            'workflow_id': r['workflow_id'],
            'segment_id': r['segment_id'],
            'segment_index': r['segment_index'],
            'content': r.get('content', ''),
        })

    return {'success': True, 'segments': segments}


def action_search(params: dict) -> dict:
    project_id = params.get('project_id', 'default')
    table = get_or_create_table(project_id)
    query = params.get('query', '')
    limit = params.get('limit', 10)

    keywords = extract_keywords(query)

    vector_results = table.search(query=query, query_type='vector').limit(limit).to_list()
    fts_results = table.search(query=keywords, query_type='fts').limit(limit).to_list()

    seen_ids = set()
    combined = []
    for r in vector_results + fts_results:
        key = (r['workflow_id'], r['segment_id'])
        if key not in seen_ids:
            seen_ids.add(key)
            combined.append({
                'workflow_id': r['workflow_id'],
                'segment_id': r['segment_id'],
                'segment_index': r['segment_index'],
                'content': r.get('content', ''),
                'file_uri': r.get('file_uri', ''),
            })

    return {'success': True, 'results': combined[:limit]}


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    action = event.get('action')
    params = event.get('params', {})

    actions = {
        'add_record': action_add_record,
        'get_segments': action_get_segments,
        'search': action_search,
    }

    if action not in actions:
        return {
            'statusCode': 400,
            'error': f'Unknown action: {action}'
        }

    try:
        result = actions[action](params)
        return {
            'statusCode': 200,
            **result
        }
    except Exception as e:
        print(f'Error in action {action}: {e}')
        return {
            'statusCode': 500,
            'error': str(e)
        }
