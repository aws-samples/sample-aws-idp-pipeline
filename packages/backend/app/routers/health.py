from fastapi import APIRouter

router = APIRouter()


@router.get("/")
@router.get("/health")
def health():
    return {"status": "ok"}
