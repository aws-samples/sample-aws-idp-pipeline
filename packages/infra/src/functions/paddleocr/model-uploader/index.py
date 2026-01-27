"""Model Uploader Lambda

Creates model.tar.gz with inference.py and uploads to S3.
Used by CDK Custom Resource during deployment.
"""
import boto3
import tarfile
import io
import json


def handler(event, context):
    """Handle Custom Resource events."""
    print(f"Event: {json.dumps(event)}")

    request_type = event.get('RequestType', '')

    if request_type == 'Delete':
        return {
            'PhysicalResourceId': event.get('PhysicalResourceId', 'model-uploader'),
            'Data': {'Status': 'DELETED'}
        }

    props = event['ResourceProperties']
    bucket_name = props['BucketName']
    inference_code = props['InferenceCode']
    output_key = props['OutputKey']

    # Create tar.gz in memory
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode='w:gz') as tar:
        # Add inference.py as code/inference.py
        code_bytes = inference_code.encode('utf-8')
        code_info = tarfile.TarInfo(name='code/inference.py')
        code_info.size = len(code_bytes)
        tar.addfile(code_info, io.BytesIO(code_bytes))

    tar_buffer.seek(0)

    # Upload to S3
    s3 = boto3.client('s3')
    s3.put_object(
        Bucket=bucket_name,
        Key=output_key,
        Body=tar_buffer.getvalue(),
        ContentType='application/gzip'
    )

    print(f"Uploaded model.tar.gz to s3://{bucket_name}/{output_key}")

    return {
        'PhysicalResourceId': f"s3://{bucket_name}/{output_key}",
        'Data': {
            'ModelDataUrl': f"s3://{bucket_name}/{output_key}"
        }
    }
