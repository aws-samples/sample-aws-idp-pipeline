# Rust lancedb-service 구현 워크플로

Python lancedb Lambda를 Rust로 완전 교체하기 위한 구현 추적.

## Actions 구현 현황

| Action | Rust 구현 | 핸들러 등록 | 테스트 | 호출처 |
|--------|-----------|-------------|--------|--------|
| `list_tables` | ✅ | ✅ | ✅ | - |
| `count` | ✅ | ✅ | ✅ | - |
| `get_segments` | ✅ | ✅ | ✅ | - |
| `get_by_segment_ids` | ✅ | ✅ | ✅ | graph-mcp |
| `hybrid_search` | ✅ | ✅ | ✅ | search-mcp, backend |
| `delete_by_workflow` | ✅ | ✅ | ✅ | - |
| `drop_table` | ✅ | ✅ | ✅ | backend |
| `add_record` | ✅ | ✅ | ✅ | lancedb-writer, qa-regenerator |
| `delete_record` | ✅ | ✅ | ✅ | reanalysis-prep, qa-regenerator |

## 호출처 전환 현황

| 호출처 | 현재 참조 | Rust 전환 |
|--------|-----------|-----------|
| backend (Fargate) | `LANCE_SERVICE_FUNCTION_ARN` | ✅ |
| search-mcp | `LANCE_SERVICE_FUNCTION_ARN` | ✅ |
| graph-mcp | `LANCE_SERVICE_FUNCTION_ARN` | ✅ |
| workflow-stack | `LANCE_SERVICE_FUNCTION_ARN` | ✅ |

## 남은 작업

1. Python lancedb Lambda 제거

## 개선 이슈

- `add_record` 호출처(lancedb-writer, qa-regenerator, analysis-finalizer)에서 `language` 파라미터를 전달하지 않음. 현재 Rust 기본값 `"ko"`로 동작하지만, 다국어 지원 시 호출처에서 `language`를 전달하도록 수정 필요
