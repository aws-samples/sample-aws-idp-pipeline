import json
from functools import lru_cache
from typing import Any

import boto3
from lancedb.embeddings import TextEmbeddingFunction, register
from pydantic import PrivateAttr


@register("bedrock-nova")
class BedrockEmbeddingFunction(TextEmbeddingFunction):
    model_id: str = "amazon.nova-2-multimodal-embeddings-v1:0"
    region_name: str = "us-east-1"

    _client: Any = PrivateAttr()
    _ndims: int = PrivateAttr()

    def __init__(self, **data):
        super().__init__(**data)
        self._client = boto3.client("bedrock-runtime", region_name=self.region_name)

        if "nova" in self.model_id or "v2" in self.model_id:
            self._ndims = 1024
        else:
            self._ndims = 1536

    def ndims(self):
        return self._ndims

    def generate_embeddings(self, texts):
        embeddings = []
        for text in texts:
            response = self._client.invoke_model(
                modelId=self.model_id,
                body=json.dumps(
                    {
                        "taskType": "SINGLE_EMBEDDING",
                        "singleEmbeddingParams": {
                            "embeddingPurpose": "GENERIC_INDEX",
                            "embeddingDimension": 1024,
                            "text": {"truncationMode": "END", "value": text},
                        },
                    }
                ),
                contentType="application/json",
            )

            result = json.loads(response["body"].read())
            embedding = result["embeddings"][0]["embedding"]
            embeddings.append(embedding)

        return embeddings


@lru_cache
def get_embedding_function() -> BedrockEmbeddingFunction:
    return BedrockEmbeddingFunction()


def get_embedding(text: str) -> list[float]:
    """텍스트를 임베딩 벡터로 변환합니다."""
    func = get_embedding_function()
    return func.generate_embeddings([text])[0]
