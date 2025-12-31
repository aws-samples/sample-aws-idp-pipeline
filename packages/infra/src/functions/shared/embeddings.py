import json
import os
from typing import Any, List

import boto3
from lancedb.embeddings import TextEmbeddingFunction, register
from pydantic import PrivateAttr


@register('bedrock-nova')
class BedrockEmbeddingFunction(TextEmbeddingFunction):
    model_id: str = 'amazon.nova-embed-image-v1:0'
    region_name: str = 'us-east-1'

    _client: Any = PrivateAttr()
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

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        embeddings = []
        for text in texts:
            try:
                response = self._client.invoke_model(
                    modelId=self.model_id,
                    body=json.dumps({
                        'inputText': text[:10000]
                    }),
                    contentType='application/json'
                )
                result = json.loads(response['body'].read())
                embedding = result.get('embedding', [0.0] * self._ndims)
                embeddings.append(embedding)
            except Exception as e:
                print(f'Error generating embedding: {e}')
                embeddings.append([0.0] * self._ndims)

        return embeddings


def generate_single_embedding(text: str, client=None) -> List[float]:
    if client is None:
        client = boto3.client(
            'bedrock-runtime',
            region_name=os.environ.get('AWS_REGION', 'us-east-1')
        )

    try:
        response = client.invoke_model(
            modelId='amazon.nova-embed-image-v1:0',
            body=json.dumps({
                'inputText': text[:10000]
            }),
            contentType='application/json'
        )
        result = json.loads(response['body'].read())
        return result.get('embedding', [0.0] * 1024)
    except Exception as e:
        print(f'Error generating embedding: {e}')
        return [0.0] * 1024
