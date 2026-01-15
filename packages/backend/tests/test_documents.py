from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestListDocuments:
    @patch("app.ddb.documents.get_table")
    def test_list_documents_success(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.query.return_value = {
            "Items": [
                {
                    "PK": "PROJ#proj-1",
                    "SK": "DOC#doc-1",
                    "GSI1PK": "PROJ#proj-1#DOC",
                    "GSI1SK": "2024-01-01T00:00:00+00:00",
                    "data": {
                        "document_id": "doc-1",
                        "project_id": "proj-1",
                        "name": "test.pdf",
                        "file_type": "application/pdf",
                        "file_size": 1024,
                        "status": "completed",
                        "s3_key": "projects/proj-1/documents/doc-1/test.pdf",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                },
                {
                    "PK": "PROJ#proj-1",
                    "SK": "DOC#doc-2",
                    "GSI1PK": "PROJ#proj-1#DOC",
                    "GSI1SK": "2024-01-02T00:00:00+00:00",
                    "data": {
                        "document_id": "doc-2",
                        "project_id": "proj-1",
                        "name": "image.png",
                        "file_type": "image/png",
                        "file_size": 2048,
                        "status": "completed",
                        "s3_key": "projects/proj-1/documents/doc-2/image.png",
                    },
                    "created_at": "2024-01-02T00:00:00+00:00",
                    "updated_at": "2024-01-02T00:00:00+00:00",
                },
            ]
        }
        mock_get_table.return_value = mock_table

        response = client.get("/projects/proj-1/documents")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["document_id"] == "doc-1"
        assert data[0]["name"] == "test.pdf"
        assert data[1]["document_id"] == "doc-2"

    @patch("app.ddb.documents.get_table")
    def test_list_documents_empty(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.query.return_value = {"Items": []}
        mock_get_table.return_value = mock_table

        response = client.get("/projects/proj-1/documents")

        assert response.status_code == 200
        assert response.json() == []


class TestCreateDocumentUpload:
    @patch("app.routers.documents.get_s3_client")
    @patch("app.ddb.documents.get_table")
    @patch("app.ddb.projects.get_table")
    def test_create_document_upload_success(self, mock_proj_get_table, mock_doc_get_table, mock_get_s3):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "PK": "PROJ#proj-1",
                "SK": "META",
                "GSI1PK": "PROJECTS",
                "GSI1SK": "2024-01-01T00:00:00+00:00",
                "data": {
                    "project_id": "proj-1",
                    "name": "Test",
                    "description": "",
                    "status": "active",
                },
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            }
        }
        mock_proj_get_table.return_value = mock_table
        mock_doc_get_table.return_value = mock_table

        mock_s3 = MagicMock()
        mock_s3.generate_presigned_url.return_value = "https://s3.amazonaws.com/presigned-url"
        mock_get_s3.return_value = mock_s3

        response = client.post(
            "/projects/proj-1/documents",
            json={
                "file_name": "test.pdf",
                "content_type": "application/pdf",
                "file_size": 1024,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["file_name"] == "test.pdf"
        assert "document_id" in data
        assert data["upload_url"] == "https://s3.amazonaws.com/presigned-url"
        mock_table.put_item.assert_called_once()

    @patch("app.ddb.projects.get_table")
    def test_create_document_upload_project_not_found(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_get_table.return_value = mock_table

        response = client.post(
            "/projects/nonexistent/documents",
            json={
                "file_name": "test.pdf",
                "content_type": "application/pdf",
                "file_size": 1024,
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found"

    def test_create_document_upload_file_too_large(self):
        response = client.post(
            "/projects/proj-1/documents",
            json={
                "file_name": "large.pdf",
                "content_type": "application/pdf",
                "file_size": 600 * 1024 * 1024,  # 600MB
            },
        )

        assert response.status_code == 400
        assert "500MB" in response.json()["detail"]


class TestUpdateDocumentStatus:
    @patch("app.ddb.documents.get_table")
    def test_update_status_success(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.side_effect = [
            {
                "Item": {
                    "PK": "PROJ#proj-1",
                    "SK": "DOC#doc-1",
                    "GSI1PK": "PROJ#proj-1#DOC",
                    "GSI1SK": "2024-01-01T00:00:00+00:00",
                    "data": {
                        "document_id": "doc-1",
                        "project_id": "proj-1",
                        "name": "test.pdf",
                        "file_type": "application/pdf",
                        "file_size": 1024,
                        "status": "uploading",
                        "s3_key": "projects/proj-1/documents/doc-1/test.pdf",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                }
            },
            {
                "Item": {
                    "PK": "PROJ#proj-1",
                    "SK": "DOC#doc-1",
                    "GSI1PK": "PROJ#proj-1#DOC",
                    "GSI1SK": "2024-01-01T00:01:00+00:00",
                    "data": {
                        "document_id": "doc-1",
                        "project_id": "proj-1",
                        "name": "test.pdf",
                        "file_type": "application/pdf",
                        "file_size": 1024,
                        "status": "completed",
                        "s3_key": "projects/proj-1/documents/doc-1/test.pdf",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:01:00+00:00",
                }
            },
        ]
        mock_get_table.return_value = mock_table

        response = client.put(
            "/projects/proj-1/documents/doc-1/status",
            json={"status": "completed"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "completed"

    @patch("app.ddb.documents.get_table")
    def test_update_status_not_found(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_get_table.return_value = mock_table

        response = client.put(
            "/projects/proj-1/documents/nonexistent/status",
            json={"status": "completed"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Document not found"


class TestGetDocument:
    @patch("app.ddb.documents.get_table")
    def test_get_document_success(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "PK": "PROJ#proj-1",
                "SK": "DOC#doc-1",
                "GSI1PK": "PROJ#proj-1#DOC",
                "GSI1SK": "2024-01-01T00:00:00+00:00",
                "data": {
                    "document_id": "doc-1",
                    "project_id": "proj-1",
                    "name": "test.pdf",
                    "file_type": "application/pdf",
                    "file_size": 1024,
                    "status": "completed",
                    "s3_key": "projects/proj-1/documents/doc-1/test.pdf",
                },
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            }
        }
        mock_get_table.return_value = mock_table

        response = client.get("/projects/proj-1/documents/doc-1")

        assert response.status_code == 200
        data = response.json()
        assert data["document_id"] == "doc-1"
        assert data["name"] == "test.pdf"

    @patch("app.ddb.documents.get_table")
    def test_get_document_not_found(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_get_table.return_value = mock_table

        response = client.get("/projects/proj-1/documents/nonexistent")

        assert response.status_code == 404
        assert response.json()["detail"] == "Document not found"


class TestDeleteDocument:
    @patch("app.routers.documents.get_s3_client")
    @patch("app.ddb.client.get_table")
    @patch("app.ddb.workflows.get_table")
    @patch("app.ddb.documents.get_table")
    def test_delete_document_success(self, mock_doc_get_table, mock_wf_get_table, mock_client_get_table, mock_get_s3):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "PK": "PROJ#proj-1",
                "SK": "DOC#doc-1",
                "GSI1PK": "PROJ#proj-1#DOC",
                "GSI1SK": "2024-01-01T00:00:00+00:00",
                "data": {
                    "document_id": "doc-1",
                    "project_id": "proj-1",
                    "name": "test.pdf",
                    "file_type": "application/pdf",
                    "file_size": 1024,
                    "status": "completed",
                    "s3_key": "projects/proj-1/documents/doc-1/test.pdf",
                },
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            }
        }
        mock_table.query.return_value = {"Items": []}
        mock_doc_get_table.return_value = mock_table
        mock_wf_get_table.return_value = mock_table
        mock_client_get_table.return_value = mock_table

        mock_s3 = MagicMock()
        mock_paginator = MagicMock()
        mock_paginator.paginate.return_value = []
        mock_s3.get_paginator.return_value = mock_paginator
        mock_get_s3.return_value = mock_s3

        response = client.delete("/projects/proj-1/documents/doc-1")

        assert response.status_code == 200
        data = response.json()
        assert "deleted" in data["message"].lower()
        mock_table.delete_item.assert_called()

    @patch("app.ddb.documents.get_table")
    def test_delete_document_not_found(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_get_table.return_value = mock_table

        response = client.delete("/projects/proj-1/documents/nonexistent")

        assert response.status_code == 404
        assert response.json()["detail"] == "Document not found"
