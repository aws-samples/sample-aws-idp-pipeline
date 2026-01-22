import boto3

from app.config import get_config

config = get_config()

bedrock_client = boto3.client("bedrock-agent-runtime", region_name=config.aws_region)
MODEL_ARN = f"arn:aws:bedrock:{config.aws_region}::foundation-model/cohere.rerank-v3-5:0"


def rerank(query: str, documents: list[str], num_results: int | None = None) -> list[tuple[int, float]]:
    # 빈 문서 필터링 (원본 인덱스 유지)
    indexed_docs = [(i, doc) for i, doc in enumerate(documents) if doc]
    if not indexed_docs:
        return []

    sources = [
        {"type": "INLINE", "inlineDocumentSource": {"type": "TEXT", "textDocument": {"text": doc}}}
        for _, doc in indexed_docs
    ]

    reranking_config = {
        "type": "BEDROCK_RERANKING_MODEL",
        "bedrockRerankingConfiguration": {
            "modelConfiguration": {"modelArn": MODEL_ARN},
        },
    }

    if num_results:
        # numberOfResults는 sources 개수를 초과할 수 없음
        actual_num_results = min(num_results, len(sources))
        reranking_config["bedrockRerankingConfiguration"]["numberOfResults"] = actual_num_results

    response = bedrock_client.rerank(
        queries=[{"type": "TEXT", "textQuery": {"text": query}}],
        sources=sources,
        rerankingConfiguration=reranking_config,
    )

    # 필터링된 인덱스를 원본 인덱스로 매핑
    return [(indexed_docs[result["index"]][0], result["relevanceScore"]) for result in response["results"]]
