"""Transcribe Consumer Lambda

Receives video/audio files from SQS queue and transcribes them using AWS Transcribe.
Polls for completion and updates DynamoDB preprocess status.
"""
import json
import os
import time
from datetime import datetime, timezone

import boto3

from shared.ddb_client import (
    update_preprocess_status,
    PreprocessStatus,
    PreprocessType,
    record_step_start,
    record_step_complete,
    record_step_error,
    record_step_skipped,
    StepName,
)
from shared.s3_analysis import get_s3_client, parse_s3_uri

TRANSCRIBE_OUTPUT_BUCKET = os.environ.get('TRANSCRIBE_OUTPUT_BUCKET', '')

SUPPORTED_MIME_TYPES = {
    # Video
    'video/mp4',
    'video/webm',
    # Audio
    'audio/mpeg',      # MP3
    'audio/mp4',       # MP4 audio
    'audio/wav',       # WAV
    'audio/x-wav',     # WAV (alternative)
    'audio/flac',      # FLAC
    'audio/amr',       # AMR
    'audio/ogg',       # OGG
    'audio/webm',      # WebM audio
}

MEDIA_FORMAT_MAP = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'mp4',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/amr': 'amr',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
}

# Supported languages for automatic identification
IDENTIFY_LANGUAGE_OPTIONS = [
    'en-US', 'ko-KR', 'ja-JP', 'zh-CN', 'zh-TW',
    'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR',
]

POLL_INTERVAL_SECONDS = 10
MAX_POLL_ATTEMPTS = 180  # ~30 minutes max

transcribe_client = None


def get_transcribe_client():
    global transcribe_client
    if transcribe_client is None:
        transcribe_client = boto3.client(
            'transcribe',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )
    return transcribe_client


def start_transcription_job(
    file_uri: str,
    project_id: str,
    document_id: str,
    workflow_id: str,
    file_type: str,
) -> str:
    """Start AWS Transcribe job with automatic language identification."""
    client = get_transcribe_client()

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    job_name = f'{workflow_id[:32]}-{timestamp}'

    if document_id:
        output_key = f'projects/{project_id}/documents/{document_id}/transcribe/{job_name}.json'
    else:
        output_key = f'transcribe/{workflow_id}/{job_name}.json'

    media_format = MEDIA_FORMAT_MAP.get(file_type, 'mp4')

    print(f'Starting transcription job: {job_name}, format={media_format}, auto language identification')

    client.start_transcription_job(
        TranscriptionJobName=job_name,
        IdentifyLanguage=True,
        LanguageOptions=IDENTIFY_LANGUAGE_OPTIONS,
        MediaFormat=media_format,
        Media={
            'MediaFileUri': file_uri
        },
        OutputBucketName=TRANSCRIBE_OUTPUT_BUCKET,
        OutputKey=output_key,
    )

    return job_name


def poll_transcription_status(job_name: str) -> tuple[str, str | None]:
    """Poll transcription job status until completion or failure.

    Returns:
        tuple of (status, output_uri or error_message)
    """
    client = get_transcribe_client()

    for attempt in range(MAX_POLL_ATTEMPTS):
        response = client.get_transcription_job(
            TranscriptionJobName=job_name
        )

        job = response.get('TranscriptionJob', {})
        status = job.get('TranscriptionJobStatus', 'Unknown')
        print(f'Transcription status (attempt {attempt + 1}): {status}')

        if status == 'COMPLETED':
            transcript = job.get('Transcript', {})
            transcript_uri = transcript.get('TranscriptFileUri', '')
            return 'Success', transcript_uri

        elif status == 'FAILED':
            failure_reason = job.get('FailureReason', 'Unknown error')
            return 'Failed', failure_reason

        elif status in ['QUEUED', 'IN_PROGRESS']:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        else:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

    return 'Timeout', 'Transcription job timed out'


def save_transcript_text(transcript_uri: str, project_id: str, document_id: str, workflow_id: str) -> str:
    """Download transcript JSON, extract text, and save as plain text."""
    s3_client = get_s3_client()

    # Parse the transcript URI
    # Transcribe returns HTTPS URL, convert to S3 format
    if transcript_uri.startswith('https://'):
        # Example: https://s3.us-east-1.amazonaws.com/bucket/key
        # or https://bucket.s3.us-east-1.amazonaws.com/key
        parts = transcript_uri.replace('https://', '').split('/')
        if '.s3.' in parts[0]:
            bucket = parts[0].split('.s3.')[0]
            key = '/'.join(parts[1:])
        else:
            bucket = parts[1]
            key = '/'.join(parts[2:])
    else:
        bucket, key = parse_s3_uri(transcript_uri)

    # Download transcript JSON
    response = s3_client.get_object(Bucket=bucket, Key=key)
    transcript_data = json.loads(response['Body'].read().decode('utf-8'))

    # Extract plain text from transcript
    results = transcript_data.get('results', {})
    transcripts = results.get('transcripts', [])
    full_text = ' '.join([t.get('transcript', '') for t in transcripts])

    # Save as plain text file
    if document_id:
        text_key = f'projects/{project_id}/documents/{document_id}/transcribe/transcript.txt'
    else:
        text_key = f'transcribe/{workflow_id}/transcript.txt'

    s3_client.put_object(
        Bucket=bucket,
        Key=text_key,
        Body=full_text.encode('utf-8'),
        ContentType='text/plain'
    )

    return f's3://{bucket}/{text_key}'


def process_message(message: dict) -> dict:
    """Process a single message from the queue."""
    workflow_id = message.get('workflow_id')
    document_id = message.get('document_id')
    project_id = message.get('project_id')
    file_uri = message.get('file_uri')
    file_type = message.get('file_type')

    print(f'Processing transcription job: workflow={workflow_id}, file={file_uri}')

    # Check if file type is supported
    if file_type not in SUPPORTED_MIME_TYPES:
        print(f'Skipping unsupported file type: {file_type}')
        update_preprocess_status(
            document_id=document_id,
            workflow_id=workflow_id,
            processor=PreprocessType.TRANSCRIBE,
            status=PreprocessStatus.SKIPPED,
            reason=f'File type {file_type} not supported'
        )
        record_step_skipped(workflow_id, StepName.TRANSCRIBE, f'File type {file_type} not supported')
        return {'status': 'skipped', 'reason': f'Unsupported file type: {file_type}'}

    # Update STEP record to in_progress
    record_step_start(workflow_id, StepName.TRANSCRIBE)

    # Update preprocess status to processing
    update_preprocess_status(
        document_id=document_id,
        workflow_id=workflow_id,
        processor=PreprocessType.TRANSCRIBE,
        status=PreprocessStatus.PROCESSING
    )

    try:
        # Start transcription job
        job_name = start_transcription_job(
            file_uri=file_uri,
            project_id=project_id,
            document_id=document_id,
            workflow_id=workflow_id,
            file_type=file_type,
        )

        # Poll for completion
        status, result = poll_transcription_status(job_name)

        if status == 'Success':
            print(f'Transcription completed: {result}')

            # Save plain text version
            text_uri = save_transcript_text(
                transcript_uri=result,
                project_id=project_id,
                document_id=document_id,
                workflow_id=workflow_id
            )

            update_preprocess_status(
                document_id=document_id,
                workflow_id=workflow_id,
                processor=PreprocessType.TRANSCRIBE,
                status=PreprocessStatus.COMPLETED,
                output_uri=result,
                text_uri=text_uri,
                job_name=job_name
            )
            record_step_complete(workflow_id, StepName.TRANSCRIBE)
            return {
                'status': 'completed',
                'output_uri': result,
                'text_uri': text_uri,
                'job_name': job_name
            }
        else:
            print(f'Transcription failed: {result}')
            update_preprocess_status(
                document_id=document_id,
                workflow_id=workflow_id,
                processor=PreprocessType.TRANSCRIBE,
                status=PreprocessStatus.FAILED,
                error=result,
                job_name=job_name
            )
            record_step_error(workflow_id, StepName.TRANSCRIBE, result or 'Unknown error')
            return {
                'status': 'failed',
                'error': result,
                'job_name': job_name
            }

    except Exception as e:
        print(f'Error processing transcription: {e}')
        update_preprocess_status(
            document_id=document_id,
            workflow_id=workflow_id,
            processor=PreprocessType.TRANSCRIBE,
            status=PreprocessStatus.FAILED,
            error=str(e)
        )
        record_step_error(workflow_id, StepName.TRANSCRIBE, str(e))
        raise


def handler(event, context):
    print(f'Event: {json.dumps(event)}')

    results = []

    for record in event.get('Records', []):
        try:
            message = json.loads(record.get('body', '{}'))
            result = process_message(message)
            results.append({
                'workflow_id': message.get('workflow_id'),
                **result
            })

        except Exception as e:
            print(f'Error processing record: {e}')
            import traceback
            traceback.print_exc()
            results.append({
                'status': 'failed',
                'error': str(e)
            })

    return {
        'statusCode': 200,
        'body': json.dumps({
            'processed': len(results),
            'results': results
        })
    }
