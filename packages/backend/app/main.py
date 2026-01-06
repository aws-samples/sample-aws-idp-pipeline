from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health, tables

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(tables.router)
