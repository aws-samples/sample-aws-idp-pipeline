from datetime import datetime

from fastapi import APIRouter, HTTPException, Path, Query
from lancedb.pydantic import LanceModel, Vector
from pydantic import BaseModel

from app.embedding import get_embedding_function
from app.keywords import extract_keywords
from app.lancedb import get_db
from app.reranker import rerank

embedding_function = get_embedding_function()


class DocumentRecord(LanceModel):
    workflow_id: str
    segment_id: str
    segment_index: int

    content: str = embedding_function.SourceField()
    vector: Vector(1024) = embedding_function.VectorField()  # type: ignore
    keywords: str

    file_uri: str
    file_type: str
    image_uri: str | None = None
    created_at: datetime


router = APIRouter(prefix="/projects/{project_id}/search", tags=["search"])


class SearchResult(BaseModel):
    workflow_id: str
    segment_id: str
    segment_index: int
    content: str
    keywords: str
    score: float


class HybridSearchResponse(BaseModel):
    results: list[SearchResult]


class RerankedSearchResult(BaseModel):
    workflow_id: str
    segment_id: str
    segment_index: int
    content: str
    keywords: str
    rerank_score: float


class RerankedSearchResponse(BaseModel):
    results: list[RerankedSearchResult]


@router.get("/hybrid", response_model=HybridSearchResponse)
def hybrid_search(
    project_id: str = Path(..., description="프로젝트 ID"),
    query: str = Query(..., description="검색 쿼리"),
    document_id: str | None = Query(None, description="특정 문서 내에서만 검색"),
    limit: int = Query(10, description="반환할 결과 수"),
) -> HybridSearchResponse:
    """
    하이브리드 검색: 벡터 유사도 검색 + Full-Text Search

    - query: 검색 쿼리 텍스트
    - document_id: 특정 문서 내에서만 검색 (선택)
    - limit: 반환할 결과 수
    """
    db = get_db()
    table_name = project_id

    if table_name not in db.table_names():
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")

    table = db.open_table(f"{table_name}")

    keywords = extract_keywords(query)
    search_query = table.search(query=keywords, query_type="hybrid").limit(limit)

    if document_id:
        search_query = search_query.where(f"document_id = '{document_id}'")

    results = search_query.to_list()

    return HybridSearchResponse(
        results=[
            SearchResult(
                workflow_id=row["workflow_id"],
                segment_id=row["segment_id"],
                segment_index=row["segment_index"],
                content=row["content"],
                keywords=row["keywords"],
                score=row.get("_relevance_score", 0.0),
            )
            for row in results
        ]
    )


@router.get("/rerank", response_model=RerankedSearchResponse)
def rerank_search(
    project_id: str = Path(..., description="프로젝트 ID"),
    query: str = Query(..., description="검색 쿼리"),
    document_id: str | None = Query(None, description="특정 문서 내에서만 검색"),
    limit: int = Query(3, description="최종 반환할 결과 수"),
    candidate_limit: int = Query(20, description="리랭킹 전 후보 수"),
) -> RerankedSearchResponse:
    """
    리랭크 검색: 하이브리드 검색 후 Bedrock Cohere Rerank로 리랭킹

    - query: 검색 쿼리 텍스트
    - document_id: 특정 문서 내에서만 검색 (선택)
    - limit: 최종 반환할 결과 수
    - candidate_limit: 리랭킹 전 후보 수 (보통 limit의 5~10배)
    """
    db = get_db()
    table_name = project_id

    if table_name not in db.table_names():
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")

    table = db.open_table(f"{table_name}")

    # Step 1: 하이브리드 검색으로 후보군 확보
    keywords = extract_keywords(query)
    search_query = table.search(query=keywords, query_type="hybrid").limit(candidate_limit)

    if document_id:
        search_query = search_query.where(f"document_id = '{document_id}'")

    candidates = search_query.to_list()

    if not candidates:
        return RerankedSearchResponse(results=[])

    # Step 2: 리랭킹
    doc_contents = [row["content"] for row in candidates]
    actual_limit = min(limit, len(doc_contents))
    ranked_results = rerank(query, doc_contents, num_results=actual_limit)

    # Step 3: 인덱스로 원본 문서 매핑
    return RerankedSearchResponse(
        results=[
            RerankedSearchResult(
                workflow_id=candidates[idx]["workflow_id"],
                segment_id=candidates[idx]["segment_id"],
                segment_index=candidates[idx]["segment_index"],
                content=candidates[idx]["content"],
                keywords=candidates[idx]["keywords"],
                rerank_score=score,
            )
            for idx, score in ranked_results
        ]
    )
