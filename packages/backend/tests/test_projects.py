from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestListProjects:
    @patch("app.ddb.projects.get_table")
    def test_list_projects_success(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.query.return_value = {
            "Items": [
                {
                    "PK": "PROJ#proj-1",
                    "SK": "META",
                    "GSI1PK": "PROJECTS",
                    "GSI1SK": "2024-01-01T00:00:00+00:00",
                    "data": {
                        "project_id": "proj-1",
                        "name": "Project One",
                        "description": "First project",
                        "status": "active",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                },
                {
                    "PK": "PROJ#proj-2",
                    "SK": "META",
                    "GSI1PK": "PROJECTS",
                    "GSI1SK": "2024-01-02T00:00:00+00:00",
                    "data": {
                        "project_id": "proj-2",
                        "name": "Project Two",
                        "description": "",
                        "status": "active",
                    },
                    "created_at": "2024-01-02T00:00:00+00:00",
                    "updated_at": "2024-01-02T00:00:00+00:00",
                },
            ]
        }
        mock_get_table.return_value = mock_table

        response = client.get("/projects")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["project_id"] == "proj-1"
        assert data[0]["name"] == "Project One"
        assert data[1]["project_id"] == "proj-2"

    @patch("app.ddb.projects.get_table")
    def test_list_projects_empty(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.query.return_value = {"Items": []}
        mock_get_table.return_value = mock_table

        response = client.get("/projects")

        assert response.status_code == 200
        assert response.json() == []


class TestGetProject:
    @patch("app.ddb.projects.get_table")
    def test_get_project_success(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "PK": "PROJ#proj-1",
                "SK": "META",
                "data": {
                    "project_id": "proj-1",
                    "name": "Test Project",
                    "description": "A test project",
                    "status": "active",
                },
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
                "GSI1PK": "PROJECTS",
                "GSI1SK": "2024-01-01T00:00:00+00:00",
            }
        }
        mock_get_table.return_value = mock_table

        response = client.get("/projects/proj-1")

        assert response.status_code == 200
        data = response.json()
        assert data["project_id"] == "proj-1"
        assert data["name"] == "Test Project"
        assert data["description"] == "A test project"
        assert data["status"] == "active"

    @patch("app.ddb.projects.get_table")
    def test_get_project_not_found(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_get_table.return_value = mock_table

        response = client.get("/projects/nonexistent")

        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found"


class TestCreateProject:
    @patch("app.ddb.projects.get_table")
    def test_create_project_success(self, mock_get_table):
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        response = client.post(
            "/projects",
            json={
                "name": "New Project",
                "description": "A new project",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["project_id"].startswith("proj_")
        assert data["name"] == "New Project"
        assert data["description"] == "A new project"
        assert data["status"] == "active"
        mock_table.put_item.assert_called_once()

    @patch("app.ddb.projects.get_table")
    def test_create_project_with_created_by(self, mock_get_table):
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        response = client.post(
            "/projects",
            json={
                "name": "User Project",
                "description": "",
                "created_by": "test@example.com",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["created_by"] == "test@example.com"

    @patch("app.ddb.projects.get_table")
    def test_create_project_without_description(self, mock_get_table):
        mock_table = MagicMock()
        mock_get_table.return_value = mock_table

        response = client.post(
            "/projects",
            json={
                "name": "No Description",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["description"] == ""


class TestUpdateProject:
    @patch("app.ddb.projects.get_table")
    def test_update_project_success(self, mock_get_table):
        mock_table = MagicMock()
        # First call for checking existence, second for get after update
        mock_table.get_item.side_effect = [
            {
                "Item": {
                    "PK": "PROJ#proj-1",
                    "SK": "META",
                    "data": {
                        "project_id": "proj-1",
                        "name": "Old Name",
                        "description": "Old desc",
                        "status": "active",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                    "GSI1PK": "PROJECTS",
                    "GSI1SK": "2024-01-01T00:00:00+00:00",
                }
            },
            {
                "Item": {
                    "PK": "PROJ#proj-1",
                    "SK": "META",
                    "data": {
                        "project_id": "proj-1",
                        "name": "Updated Name",
                        "description": "Updated desc",
                        "status": "active",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-02T00:00:00+00:00",
                    "GSI1PK": "PROJECTS",
                    "GSI1SK": "2024-01-02T00:00:00+00:00",
                }
            },
        ]
        mock_get_table.return_value = mock_table

        response = client.put(
            "/projects/proj-1",
            json={"name": "Updated Name", "description": "Updated desc"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["description"] == "Updated desc"
        mock_table.update_item.assert_called_once()

    @patch("app.ddb.projects.get_table")
    def test_update_project_not_found(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_get_table.return_value = mock_table

        response = client.put(
            "/projects/nonexistent",
            json={"name": "New Name"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found"

    @patch("app.ddb.projects.get_table")
    def test_update_project_partial(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.side_effect = [
            {
                "Item": {
                    "PK": "PROJ#proj-1",
                    "SK": "META",
                    "data": {
                        "project_id": "proj-1",
                        "name": "Old Name",
                        "description": "Keep this",
                        "status": "active",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                    "GSI1PK": "PROJECTS",
                    "GSI1SK": "2024-01-01T00:00:00+00:00",
                }
            },
            {
                "Item": {
                    "PK": "PROJ#proj-1",
                    "SK": "META",
                    "data": {
                        "project_id": "proj-1",
                        "name": "Only Name Updated",
                        "description": "Keep this",
                        "status": "active",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-02T00:00:00+00:00",
                    "GSI1PK": "PROJECTS",
                    "GSI1SK": "2024-01-02T00:00:00+00:00",
                }
            },
        ]
        mock_get_table.return_value = mock_table

        response = client.put(
            "/projects/proj-1",
            json={"name": "Only Name Updated"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Only Name Updated"
        assert data["description"] == "Keep this"

    @patch("app.ddb.projects.get_table")
    def test_update_project_document_prompt(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.side_effect = [
            {
                "Item": {
                    "PK": "PROJ#proj-1",
                    "SK": "META",
                    "data": {
                        "project_id": "proj-1",
                        "name": "Test Project",
                        "description": "Test desc",
                        "status": "active",
                        "document_prompt": None,
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                    "GSI1PK": "PROJECTS",
                    "GSI1SK": "2024-01-01T00:00:00+00:00",
                }
            },
            {
                "Item": {
                    "PK": "PROJ#proj-1",
                    "SK": "META",
                    "data": {
                        "project_id": "proj-1",
                        "name": "Test Project",
                        "description": "Test desc",
                        "status": "active",
                        "document_prompt": "Extract all invoice data",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-02T00:00:00+00:00",
                    "GSI1PK": "PROJECTS",
                    "GSI1SK": "2024-01-02T00:00:00+00:00",
                }
            },
        ]
        mock_get_table.return_value = mock_table

        response = client.put(
            "/projects/proj-1",
            json={"document_prompt": "Extract all invoice data"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["document_prompt"] == "Extract all invoice data"
        mock_table.update_item.assert_called_once()


class TestDeleteProject:
    @patch("app.ddb.workflows.get_table")
    @patch("app.s3.delete_s3_prefix")
    @patch("app.ddb.client.get_table")
    @patch("app.ddb.projects.get_table")
    def test_delete_project_success(
        self, mock_proj_get_table, mock_client_get_table, mock_delete_s3_prefix, mock_wf_get_table
    ):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {
                "PK": "PROJ#proj-1",
                "SK": "META",
                "data": {
                    "project_id": "proj-1",
                    "name": "Test",
                    "description": "",
                    "status": "active",
                },
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
                "GSI1PK": "PROJECTS",
                "GSI1SK": "2024-01-01T00:00:00+00:00",
            }
        }
        mock_table.query.return_value = {
            "Items": [
                {"PK": "PROJ#proj-1", "SK": "META"},
                {"PK": "PROJ#proj-1", "SK": "DOC#doc-1"},
            ]
        }
        mock_batch_writer = MagicMock()
        mock_table.batch_writer.return_value.__enter__ = MagicMock(return_value=mock_batch_writer)
        mock_table.batch_writer.return_value.__exit__ = MagicMock(return_value=False)
        mock_proj_get_table.return_value = mock_table
        mock_client_get_table.return_value = mock_table

        mock_wf_table = MagicMock()
        mock_wf_table.query.return_value = {"Items": []}
        mock_wf_get_table.return_value = mock_wf_table

        mock_delete_s3_prefix.return_value = 0

        response = client.delete("/projects/proj-1")

        assert response.status_code == 200
        data = response.json()
        assert "deleted" in data["message"].lower()

    @patch("app.ddb.projects.get_table")
    def test_delete_project_not_found(self, mock_get_table):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_get_table.return_value = mock_table

        response = client.delete("/projects/nonexistent")

        assert response.status_code == 404
        assert response.json()["detail"] == "Project not found"
