import boto3

from app.config import get_config

config = get_config()

bedrock_client = boto3.client("bedrock-agent-runtime", region_name=config.aws_region)
MODEL_ARN = f"arn:aws:bedrock:{config.aws_region}::foundation-model/cohere.rerank-v3-5:0"


def rerank(query: str, documents: list[str], num_results: int | None = None) -> list[tuple[int, float]]:
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
