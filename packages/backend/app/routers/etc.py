from fastapi import APIRouter

from app.config import Config, get_config

router = APIRouter(prefix="/etc", tags=["etc"])


@router.get("/config")
def config() -> Config:
    return get_config()
