import os
from datetime import datetime
from typing import Optional

import boto3
import lancedb
from lancedb.pydantic import LanceModel, Vector

from .embeddings import BedrockEmbeddingFunction

LANCEDB_BUCKET_SSM_KEY = '/idp-v2/lancedb/storage/bucket-name'
LANCEDB_LOCK_TABLE_SSM_KEY = '/idp-v2/lancedb/lock/table-name'

_db_connection = None
_table_name = 'documents'


def get_ssm_parameter(key: str) -> str:
    ssm = boto3.client('ssm', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    response = ssm.get_parameter(Name=key)
    return response['Parameter']['Value']


def get_lancedb_connection():
    global _db_connection
    if _db_connection is None:
        bucket_name = get_ssm_parameter(LANCEDB_BUCKET_SSM_KEY)
        lock_table_name = get_ssm_parameter(LANCEDB_LOCK_TABLE_SSM_KEY)
        _db_connection = lancedb.connect(
            f's3+ddb://{bucket_name}/idp-v2?ddbTableName={lock_table_name}'
        )
    return _db_connection


bedrock_embeddings = BedrockEmbeddingFunction.create()


class DocumentRecord(LanceModel):
    """Simplified LanceDB schema - only search-relevant fields"""
    workflow_id: str
    segment_index: int

    content: str = bedrock_embeddings.SourceField()
    vector: Vector(1024) = bedrock_embeddings.VectorField()  # type: ignore
    keywords: str

    file_uri: str
    file_type: str
    image_uri: Optional[str] = None
    created_at: datetime


def get_or_create_table(db=None):
    if db is None:
        db = get_lancedb_connection()

    table_names = db.table_names()
    if _table_name in table_names:
        return db.open_table(_table_name)
    else:
        table = db.create_table(_table_name, schema=DocumentRecord)
        table.create_fts_index('keywords', replace=True)
        return table


def upsert_document(record: dict, db=None):
    table = get_or_create_table(db)
    table.add([record])
    return record


def get_workflow_segments(workflow_id: str, db=None) -> list:
    table = get_or_create_table(db)
    results = table.search().where(f"workflow_id = '{workflow_id}'").to_list()
    return sorted(results, key=lambda x: x['segment_index'])


def hybrid_search(query: str, keywords: str, limit: int = 10, db=None) -> list:
    table = get_or_create_table(db)

    vector_results = table.search(query=query, query_type='vector').limit(limit).to_list()
    fts_results = table.search(query=keywords, query_type='fts').limit(limit).to_list()

    seen_ids = set()
    combined = []
    for r in vector_results + fts_results:
        key = (r['workflow_id'], r['segment_index'])
        if key not in seen_ids:
            seen_ids.add(key)
            combined.append(r)

    return combined[:limit]


def vector_search(query: str, limit: int = 10, db=None) -> list:
    table = get_or_create_table(db)
    return table.search(query=query, query_type='vector').limit(limit).to_list()


def fts_search(keywords: str, limit: int = 10, db=None) -> list:
    table = get_or_create_table(db)
    return table.search(query=keywords, query_type='fts').limit(limit).to_list()
