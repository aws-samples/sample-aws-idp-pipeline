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
LANCEDB_LOCK_TABLE_SSM_KEY = '/idp-v2/lancedb/lock/table-name'

_db_connection = None
_kiwi = None
_bucket_name = None
_lock_table_name = None


def get_ssm_parameter(key: str) -> str:
    ssm = boto3.client('ssm', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    response = ssm.get_parameter(Name=key)
    return response['Parameter']['Value']


def get_bucket_name():
    global _bucket_name
    if _bucket_name is None:
        _bucket_name = get_ssm_parameter(LANCEDB_EXPRESS_BUCKET_SSM_KEY)
    return _bucket_name


def get_lock_table_name():
    global _lock_table_name
    if _lock_table_name is None:
        _lock_table_name = get_ssm_parameter(LANCEDB_LOCK_TABLE_SSM_KEY)
    return _lock_table_name


def get_lancedb_connection():
    global _db_connection
    if _db_connection is None:
        bucket_name = get_bucket_name()
        lock_table = get_lock_table_name()
        _db_connection = lancedb.connect(f's3+ddb://{bucket_name}?ddbTableName={lock_table}')
    return _db_connection


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
    model_id: str = 'amazon.nova-2-multimodal-embeddings-v1:0'
    region_name: str = 'us-east-1'
    _client: object = PrivateAttr()
    _ndims: int = PrivateAttr()

    def __init__(self, **data):
        super().__init__(**data)
        self._client = boto3.client(
            'bedrock-runtime',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
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
                    body=json.dumps({
                        'taskType': 'SINGLE_EMBEDDING',
                        'singleEmbeddingParams': {
                            'embeddingPurpose': 'GENERIC_INDEX',
                            'embeddingDimension': 1024,
                            'text': {'truncationMode': 'END', 'value': text[:10000]}
                        }
                    }),
                    contentType='application/json'
                )
                result = json.loads(response['body'].read())
                embedding = result['embeddings'][0]['embedding']
                embeddings.append(embedding)
            except Exception as e:
                print(f'Error generating embedding: {e}')
                embeddings.append([0.0] * self._ndims)
        return embeddings


_bedrock_embeddings = None


def get_bedrock_embeddings():
    global _bedrock_embeddings
    if _bedrock_embeddings is None:
        _bedrock_embeddings = BedrockEmbeddingFunction.create()
    return _bedrock_embeddings


def get_document_record_schema():
    embeddings = get_bedrock_embeddings()

    class DocumentRecord(LanceModel):
        workflow_id: str
        document_id: str
        segment_id: str
        segment_index: int
        content: str = embeddings.SourceField()
        vector: Vector(1024) = embeddings.VectorField()
        keywords: str
        file_uri: str
        file_type: str
        image_uri: Optional[str] = None
        created_at: datetime

    return DocumentRecord


def get_or_create_table(project_id: str):
    print(f'[get_or_create_table] Connecting to LanceDB...')
    db = get_lancedb_connection()
    print(f'[get_or_create_table] Connected: {db}')

    table_name = project_id
    print(f'[get_or_create_table] Getting table names...')
    table_names = db.table_names()
    print(f'[get_or_create_table] Existing tables: {table_names}')

    if table_name in table_names:
        print(f'[get_or_create_table] Opening existing table: {table_name}')
        return db.open_table(table_name)
    else:
        print(f'[get_or_create_table] Creating new table: {table_name}')
        print(f'[get_or_create_table] Getting document record schema...')
        DocumentRecord = get_document_record_schema()
        print(f'[get_or_create_table] Schema ready, creating table...')
        table = db.create_table(table_name, schema=DocumentRecord)
        print(f'[get_or_create_table] Creating FTS index...')
        table.create_fts_index('keywords', replace=True)
        print(f'[get_or_create_table] Table created successfully')
        return table


def action_add_record(params: dict) -> dict:
    project_id = params.get('project_id', 'default')
    print(f'[add_record] project_id: {project_id}')

    print('[add_record] Getting or creating table...')
    table = get_or_create_table(project_id)
    print(f'[add_record] Table ready: {table}')

    workflow_id = params.get('workflow_id', '')
    segment_index = params.get('segment_index', 0)
    segment_id = f'{workflow_id}_{segment_index:04d}'
    content = params.get('content_combined', '')
    print(f'[add_record] Extracting keywords from content (len={len(content)})')
    keywords = extract_keywords(content) if content else ''
    print(f'[add_record] Keywords: {keywords[:100]}...')
    created_at_str = params.get('created_at', '')

    if created_at_str:
        created_at = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
    else:
        created_at = datetime.now(timezone.utc)

    record = {
        'workflow_id': workflow_id,
        'document_id': params.get('document_id', ''),
        'segment_id': segment_id,
        'segment_index': segment_index,
        'content': content[:10000],
        'keywords': keywords,
        'file_uri': params.get('file_uri', ''),
        'file_type': params.get('file_type', ''),
        'image_uri': params.get('image_uri'),
        'created_at': created_at
    }

    print(f'[add_record] Adding record to table...')
    table.add([record])
    print(f'[add_record] Record added successfully: {segment_id}')
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


def action_list_tables(params: dict) -> dict:
    """List all tables in LanceDB."""
    db = get_lancedb_connection()
    table_names = db.table_names()
    return {'success': True, 'tables': table_names}


def action_count(params: dict) -> dict:
    """Count records in a project table."""
    project_id = params.get('project_id', 'default')
    db = get_lancedb_connection()

    if project_id not in db.table_names():
        return {'success': True, 'project_id': project_id, 'count': 0, 'exists': False}

    table = db.open_table(project_id)
    count = table.count_rows()
    return {'success': True, 'project_id': project_id, 'count': count, 'exists': True}


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


def action_delete_record(params: dict) -> dict:
    """Delete a specific segment record from LanceDB."""
    project_id = params.get('project_id', 'default')
    workflow_id = params.get('workflow_id', '')
    segment_index = params.get('segment_index', 0)
    segment_id = f'{workflow_id}_{segment_index:04d}'

    db = get_lancedb_connection()

    if project_id not in db.table_names():
        return {'success': True, 'deleted': 0, 'message': 'Table not found'}

    table = db.open_table(project_id)

    # Delete by segment_id
    try:
        table.delete(f"segment_id = '{segment_id}'")
        print(f'[delete_record] Deleted record: {segment_id}')
        return {'success': True, 'deleted': 1, 'segment_id': segment_id}
    except Exception as e:
        print(f'[delete_record] Error deleting: {e}')
        return {'success': False, 'error': str(e)}


def handler(event, _context):
    print(f'Event: {json.dumps(event)}')

    action = event.get('action')
    params = event.get('params', {})
    print(f'Action: {action}')

    actions = {
        'add_record': action_add_record,
        'delete_record': action_delete_record,
        'get_segments': action_get_segments,
        'search': action_search,
        'list_tables': action_list_tables,
        'count': action_count,
    }

    if action not in actions:
        print(f'Unknown action: {action}')
        return {
            'statusCode': 400,
            'error': f'Unknown action: {action}'
        }

    try:
        print(f'Executing action: {action}')
        result = actions[action](params)
        print(f'Action result: {result}')
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
