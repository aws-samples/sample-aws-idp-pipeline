from unittest.mock import patch

from fastapi.testclient import TestClient

from app.ddb.artifacts import PaginatedArtifacts
from app.ddb.models import Artifact, ArtifactData
from app.main import app

client = TestClient(app)


class TestListArtifacts:
    @patch("app.routers.artifacts.query_user_artifacts")
    def test_list_artifacts_success(self, mock_query):
        mock_query.return_value = PaginatedArtifacts(
            items=[
                Artifact(
                    artifact_id="art-1",
                    data=ArtifactData(
                        user_id="user-1",
                        project_id="proj-1",
                        filename="test.pdf",
                        content_type="application/pdf",
                        s3_key="artifacts/user-1/art-1/test.pdf",
                        s3_bucket="test-bucket",
                        file_size=1024,
                    ),
                    created_at="2024-01-01T00:00:00+00:00",
                ),
                Artifact(
                    artifact_id="art-2",
                    data=ArtifactData(
                        user_id="user-1",
                        project_id="proj-2",
                        filename="image.png",
                        content_type="image/png",
                        s3_key="artifacts/user-1/art-2/image.png",
                        s3_bucket="test-bucket",
                        file_size=2048,
                    ),
                    created_at="2024-01-02T00:00:00+00:00",
                ),
            ],
            next_cursor=None,
        )

        response = client.get("/artifacts", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["items"][0]["artifact_id"] == "art-1"
        assert data["items"][0]["filename"] == "test.pdf"
        assert data["items"][1]["artifact_id"] == "art-2"
        assert data["next_cursor"] is None

        mock_query.assert_called_once_with("user-1", 20, None)

    @patch("app.routers.artifacts.query_user_project_artifacts")
    def test_list_artifacts_with_project_filter(self, mock_query):
        mock_query.return_value = PaginatedArtifacts(
            items=[
                Artifact(
                    artifact_id="art-1",
                    data=ArtifactData(
                        user_id="user-1",
                        project_id="proj-1",
                        filename="test.pdf",
                        content_type="application/pdf",
                        s3_key="artifacts/user-1/art-1/test.pdf",
                        s3_bucket="test-bucket",
                        file_size=1024,
                    ),
                    created_at="2024-01-01T00:00:00+00:00",
                ),
            ],
            next_cursor=None,
        )

        response = client.get(
            "/artifacts",
            headers={"x-user-id": "user-1"},
            params={"project_id": "proj-1"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["project_id"] == "proj-1"

        mock_query.assert_called_once_with("user-1", "proj-1", 20, None)

    @patch("app.routers.artifacts.query_user_artifacts")
    def test_list_artifacts_with_pagination(self, mock_query):
        mock_query.return_value = PaginatedArtifacts(
            items=[
                Artifact(
                    artifact_id="art-1",
                    data=ArtifactData(
                        user_id="user-1",
                        project_id="proj-1",
                        filename="test.pdf",
                        content_type="application/pdf",
                        s3_key="artifacts/user-1/art-1/test.pdf",
                        s3_bucket="test-bucket",
                        file_size=1024,
                    ),
                    created_at="2024-01-01T00:00:00+00:00",
                ),
            ],
            next_cursor="next-page-token",
        )

        response = client.get(
            "/artifacts",
            headers={"x-user-id": "user-1"},
            params={"limit": 10},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
        assert data["next_cursor"] == "next-page-token"

        mock_query.assert_called_once_with("user-1", 10, None)

    @patch("app.routers.artifacts.query_user_artifacts")
    def test_list_artifacts_empty(self, mock_query):
        mock_query.return_value = PaginatedArtifacts(items=[], next_cursor=None)

        response = client.get("/artifacts", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 0
        assert data["next_cursor"] is None

    def test_list_artifacts_missing_user_id_header(self):
        response = client.get("/artifacts")

        assert response.status_code == 422
