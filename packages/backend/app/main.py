from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import agents, chat, documents, etc, health, projects, search, workflows

app = FastAPI(
    openapi_tags=[
        {"name": "etc", "description": "기타 유틸리티 API"},
        {"name": "health", "description": "헬스 체크"},
        {"name": "projects", "description": "프로젝트 관리"},
        {"name": "documents", "description": "문서 관리"},
        {"name": "workflows", "description": "워크플로우 관리"},
        {"name": "search", "description": "검색 API"},
        {"name": "chat", "description": "채팅 기록 관리"},
        {"name": "agents", "description": "커스텀 에이전트 관리"},
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
app.include_router(chat.router)
app.include_router(documents.router)
app.include_router(etc.router)
app.include_router(health.router)
app.include_router(projects.router)
app.include_router(search.router)
app.include_router(workflows.router)
