from typing import Literal

import boto3
from sentence_transformers import CrossEncoder

from app.config import get_config

config = get_config()

# Bedrock client
bedrock_client = boto3.client("bedrock-agent-runtime", region_name=config.aws_region)
MODEL_ARN = f"arn:aws:bedrock:{config.aws_region}::foundation-model/cohere.rerank-v3-5:0"

# Local model (lazy loading)
_local_reranker: CrossEncoder | None = None


def _get_local_reranker() -> CrossEncoder:
    global _local_reranker
    if _local_reranker is None:
        _local_reranker = CrossEncoder("BAAI/bge-reranker-v2-m3", model_kwargs={"dtype": "float16"})
    return _local_reranker


def rerank_bedrock(query: str, documents: list[str], num_results: int | None = None) -> list[tuple[int, float]]:
    sources = [
        {"type": "INLINE", "inlineDocumentSource": {"type": "TEXT", "textDocument": {"text": doc}}} for doc in documents
    ]

    reranking_config = {
        "type": "BEDROCK_RERANKING_MODEL",
        "bedrockRerankingConfiguration": {
            "modelConfiguration": {"modelArn": MODEL_ARN},
        },
    }

    if num_results:
        reranking_config["bedrockRerankingConfiguration"]["numberOfResults"] = num_results

    response = bedrock_client.rerank(
        queries=[{"type": "TEXT", "textQuery": {"text": query}}],
        sources=sources,
        rerankingConfiguration=reranking_config,
    )

    return [(result["index"], result["relevanceScore"]) for result in response["results"]]


def rerank_local(query: str, documents: list[str], num_results: int | None = None) -> list[tuple[int, float]]:
    reranker = _get_local_reranker()
    pairs = [[query, doc] for doc in documents]
    scores = reranker.predict(pairs)

    # (index, score) 리스트 생성 후 점수 내림차순 정렬
    indexed_scores = list(enumerate(scores.tolist()))
    indexed_scores.sort(key=lambda x: x[1], reverse=True)

    if num_results:
        indexed_scores = indexed_scores[:num_results]

    return indexed_scores


def rerank(
    query: str,
    documents: list[str],
    num_results: int | None = None,
    reranker_type: Literal["bedrock", "local"] = "bedrock",
) -> list[tuple[int, float]]:
    """
    문서를 리랭킹합니다.

    Args:
        query: 검색 쿼리
        documents: 리랭킹할 문서 리스트
        num_results: 반환할 결과 수 (None이면 전체 반환)
        reranker_type: "bedrock" (Cohere Rerank) 또는 "local" (bge-reranker-v2-m3)

    Returns:
        (원본 인덱스, 관련성 점수) 튜플 리스트 (점수 내림차순 정렬됨)
    """
    if reranker_type == "local":
        return rerank_local(query, documents, num_results)
    return rerank_bedrock(query, documents, num_results)
