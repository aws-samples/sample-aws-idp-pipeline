from fastapi import APIRouter

router = APIRouter()


@router.get("/tables")
def list_tables() -> list[str]:
    return ["table1", "table2", "table3"]
