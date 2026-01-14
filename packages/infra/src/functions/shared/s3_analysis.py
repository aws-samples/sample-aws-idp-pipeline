"""
S3 Analysis Data Helper

Handles reading/writing segment analysis data to S3.
Storage format: s3://bucket/projects/{project_id}/documents/{document_id}/analysis/segment_XXXX.json
"""
import json
import os
from typing import Optional
from urllib.parse import urlparse

import boto3

s3_client = None


def get_s3_client():
    global s3_client
    if s3_client is None:
        s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))
    return s3_client


def parse_s3_uri(uri: str) -> tuple:
    """Parse S3 URI into bucket and key."""
    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip('/')
    return bucket, key


def get_analysis_s3_key(file_uri: str, segment_index: int) -> str:
    """
    Generate S3 key for segment analysis file.

    Args:
        file_uri: Original file URI (s3://bucket/projects/{project_id}/documents/{document_id}/{file_name})
        segment_index: Segment index number

    Returns:
        S3 key like: projects/{project_id}/documents/{document_id}/analysis/segment_0000.json
    """
    _, key = parse_s3_uri(file_uri)

    # If /analysis/ already in path, extract base directory before it
    if '/analysis/' in key:
        print(f'[WARN] file_uri contains /analysis/: {file_uri}')
        base_dir = key.split('/analysis/')[0]
    else:
        # Remove file name, get directory
        base_dir = key.rsplit('/', 1)[0]

    s3_key = f'{base_dir}/analysis/segment_{segment_index:04d}.json'
    print(f'[DEBUG] get_analysis_s3_key: file_uri={file_uri} -> s3_key={s3_key}')
    return s3_key


def get_summary_s3_key(file_uri: str) -> str:
    """
    Generate S3 key for summary file.

    Args:
        file_uri: Original file URI

    Returns:
        S3 key like: projects/{project_id}/documents/{document_id}/analysis/summary.json
    """
    _, key = parse_s3_uri(file_uri)

    # If /analysis/ already in path, extract base directory before it
    if '/analysis/' in key:
        base_dir = key.split('/analysis/')[0]
    else:
        # Remove file name, get directory
        base_dir = key.rsplit('/', 1)[0]

    return f'{base_dir}/analysis/summary.json'


def save_segment_analysis(
    file_uri: str,
    segment_index: int,
    data: dict
) -> str:
    """
    Save segment analysis data to S3.

    Args:
        file_uri: Original file URI to determine bucket and path
        segment_index: Segment index
        data: Segment data dict (segment_index, image_uri, bda_indexer, format_parser, image_analysis)

    Returns:
        S3 key where data was saved
    """
    client = get_s3_client()
    bucket, _ = parse_s3_uri(file_uri)
    s3_key = get_analysis_s3_key(file_uri, segment_index)

    client.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=json.dumps(data, ensure_ascii=False, indent=2),
        ContentType='application/json'
    )

    return s3_key


def get_segment_analysis(file_uri: str, segment_index: int) -> Optional[dict]:
    """
    Get segment analysis data from S3.

    Args:
        file_uri: Original file URI
        segment_index: Segment index

    Returns:
        Segment data dict or None if not found
    """
    client = get_s3_client()
    bucket, _ = parse_s3_uri(file_uri)
    s3_key = get_analysis_s3_key(file_uri, segment_index)

    try:
        response = client.get_object(Bucket=bucket, Key=s3_key)
        return json.loads(response['Body'].read().decode('utf-8'))
    except client.exceptions.NoSuchKey:
        return None
    except Exception as e:
        print(f'Error getting segment analysis from {s3_key}: {e}')
        return None


def update_segment_analysis(
    file_uri: str,
    segment_index: int,
    **updates
) -> Optional[dict]:
    """
    Update segment analysis data in S3.
    Reads existing data, merges updates, saves back.

    Args:
        file_uri: Original file URI
        segment_index: Segment index
        **updates: Fields to update

    Returns:
        Updated data dict or None if failed
    """
    data = get_segment_analysis(file_uri, segment_index)
    if data is None:
        data = {
            'segment_index': segment_index,
            'image_uri': '',
            'bda_indexer': '',
            'format_parser': '',
            'image_analysis': []
        }

    data.update(updates)
    save_segment_analysis(file_uri, segment_index, data)
    return data


def add_segment_image_analysis(
    file_uri: str,
    segment_index: int,
    analysis_query: str,
    content: str
) -> Optional[dict]:
    """
    Add image analysis result to segment's image_analysis array.

    Args:
        file_uri: Original file URI
        segment_index: Segment index
        analysis_query: Analysis question
        content: Analysis answer

    Returns:
        Updated data dict or None if failed
    """
    data = get_segment_analysis(file_uri, segment_index)
    if data is None:
        data = {
            'segment_index': segment_index,
            'image_uri': '',
            'bda_indexer': '',
            'format_parser': '',
            'image_analysis': []
        }

    image_analysis = data.get('image_analysis', [])
    image_analysis.append({
        'analysis_query': analysis_query,
        'content': content
    })
    data['image_analysis'] = image_analysis

    save_segment_analysis(file_uri, segment_index, data)
    return data


def get_all_segment_analyses(file_uri: str, segment_count: int) -> list:
    """
    Get all segment analysis data from S3.

    Args:
        file_uri: Original file URI
        segment_count: Total number of segments

    Returns:
        List of segment data dicts
    """
    segments = []
    for i in range(segment_count):
        data = get_segment_analysis(file_uri, i)
        if data:
            segments.append(data)
    return segments


def save_summary(file_uri: str, summary: str) -> str:
    """
    Save document summary to S3.

    Args:
        file_uri: Original file URI
        summary: Summary text

    Returns:
        S3 key where summary was saved
    """
    client = get_s3_client()
    bucket, _ = parse_s3_uri(file_uri)
    s3_key = get_summary_s3_key(file_uri)

    data = {'summary': summary}

    client.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=json.dumps(data, ensure_ascii=False, indent=2),
        ContentType='application/json'
    )

    return s3_key


def get_summary(file_uri: str) -> Optional[str]:
    """
    Get document summary from S3.

    Args:
        file_uri: Original file URI

    Returns:
        Summary text or None if not found
    """
    client = get_s3_client()
    bucket, _ = parse_s3_uri(file_uri)
    s3_key = get_summary_s3_key(file_uri)

    try:
        response = client.get_object(Bucket=bucket, Key=s3_key)
        data = json.loads(response['Body'].read().decode('utf-8'))
        return data.get('summary', '')
    except client.exceptions.NoSuchKey:
        return None
    except Exception as e:
        print(f'Error getting summary from {s3_key}: {e}')
        return None
