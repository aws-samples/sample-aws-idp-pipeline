from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import (
    agents,
    artifacts,
    chat,
    documents,
    graph,
    health,
    projects,
    prompts,
    sagemaker,
    templates,
    workflows,
)

app = FastAPI(
    openapi_tags=[
        {"name": "health", "description": "헬스 체크"},
        {"name": "projects", "description": "프로젝트 관리"},
        {"name": "documents", "description": "문서 관리"},
        {"name": "workflows", "description": "워크플로우 관리"},
        {"name": "chat", "description": "채팅 기록 관리"},
        {"name": "agents", "description": "커스텀 에이전트 관리"},
        {"name": "artifacts", "description": "아티팩트 관리"},
        {"name": "prompts", "description": "프롬프트 관리"},
        {"name": "sagemaker", "description": "SageMaker 엔드포인트 관리"},
        {"name": "graph", "description": "지식 그래프 관리"},
        {"name": "templates", "description": "템플릿 관리"},
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(agents.router)
app.include_router(artifacts.router)
app.include_router(chat.router)
app.include_router(documents.router)
app.include_router(graph.router)
app.include_router(health.router)
app.include_router(projects.router)
app.include_router(prompts.router)
app.include_router(sagemaker.router)
app.include_router(templates.router)
app.include_router(workflows.router)
