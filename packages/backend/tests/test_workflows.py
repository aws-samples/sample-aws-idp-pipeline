from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestListWorkflows:
    @patch("app.routers.workflows.get_document_item")
    @patch("app.ddb.workflows.get_table")
    def test_list_workflows_success(self, mock_get_table, mock_get_document_item):
        mock_table = MagicMock()
        mock_table.query.return_value = {
            "Items": [
                {
                    "PK": "DOC#doc-1",
                    "SK": "WF#wf-1",
                    "data": {
                        "execution_arn": "arn:aws:states:us-east-1:123456789012:execution:test:wf-1",
                        "file_name": "test.pdf",
                        "file_type": "application/pdf",
                        "file_uri": "s3://bucket/test.pdf",
                        "project_id": "proj-1",
                        "status": "completed",
                        "summary": "Test summary",
                        "total_segments": 3,
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T01:00:00+00:00",
                },
            ]
        }
        mock_get_table.return_value = mock_table
        mock_get_document_item.return_value = None

        response = client.get("/documents/doc-1/workflows")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["workflow_id"] == "wf-1"
        assert data[0]["status"] == "completed"
        assert data[0]["file_name"] == "test.pdf"
        assert data[0]["file_uri"] == "s3://bucket/test.pdf"
        assert data[0]["created_at"] == "2024-01-01T00:00:00+00:00"
        assert data[0]["updated_at"] == "2024-01-01T01:00:00+00:00"

    @patch("app.routers.workflows.get_document_item")
    @patch("app.ddb.workflows.get_table")
    def test_list_workflows_empty(self, mock_get_table, mock_get_document_item):
        mock_table = MagicMock()
        mock_table.query.return_value = {"Items": []}
        mock_get_table.return_value = mock_table
        mock_get_document_item.return_value = None

        response = client.get("/documents/doc-1/workflows")

        assert response.status_code == 200
        assert response.json() == []
