import json
from io import BytesIO
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestGetProjectSessions:
    @patch("app.cache.cached_query_sessions")
    def test_get_project_sessions_success(self, mock_cached_query_sessions):
        from app.sessions import Session

        mock_cached_query_sessions.return_value = [
            Session(
                session_id="session-1",
                session_type="chat",
                created_at="2024-01-01T00:00:00Z",
                updated_at="2024-01-01T00:00:00Z",
                session_name="My Session",
            ),
            Session(
                session_id="session-2",
                session_type="chat",
                created_at="2024-01-02T00:00:00Z",
                updated_at="2024-01-02T00:00:00Z",
                session_name=None,
            ),
        ]

        response = client.get("/chat/projects/proj-1/sessions", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert len(data["sessions"]) == 2
        assert data["sessions"][0]["session_id"] == "session-1"
        assert data["sessions"][0]["session_name"] == "My Session"
        assert data["sessions"][1]["session_id"] == "session-2"
        assert data["sessions"][1]["session_name"] is None
        assert data["next_cursor"] is None

    @patch("app.cache.cached_query_sessions")
    def test_get_project_sessions_with_pagination(self, mock_cached_query_sessions):
        from app.sessions import Session

        mock_cached_query_sessions.return_value = [
            Session(
                session_id="session-1",
                session_type="chat",
                created_at="2024-01-03T00:00:00Z",
                updated_at="2024-01-03T00:00:00Z",
                session_name=None,
            ),
            Session(
                session_id="session-2",
                session_type="chat",
                created_at="2024-01-02T00:00:00Z",
                updated_at="2024-01-02T00:00:00Z",
                session_name=None,
            ),
            Session(
                session_id="session-3",
                session_type="chat",
                created_at="2024-01-01T00:00:00Z",
                updated_at="2024-01-01T00:00:00Z",
                session_name=None,
            ),
        ]

        response = client.get("/chat/projects/proj-1/sessions?limit=2", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert len(data["sessions"]) == 2
        assert data["next_cursor"] == "session-2"

    @patch("app.cache.cached_query_sessions")
    def test_get_project_sessions_with_cursor(self, mock_cached_query_sessions):
        from app.sessions import Session

        mock_cached_query_sessions.return_value = [
            Session(
                session_id="session-1",
                session_type="chat",
                created_at="2024-01-03T00:00:00Z",
                updated_at="2024-01-03T00:00:00Z",
                session_name=None,
            ),
            Session(
                session_id="session-2",
                session_type="chat",
                created_at="2024-01-02T00:00:00Z",
                updated_at="2024-01-02T00:00:00Z",
                session_name=None,
            ),
            Session(
                session_id="session-3",
                session_type="chat",
                created_at="2024-01-01T00:00:00Z",
                updated_at="2024-01-01T00:00:00Z",
                session_name=None,
            ),
        ]

        response = client.get("/chat/projects/proj-1/sessions?cursor=session-2", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert len(data["sessions"]) == 1
        assert data["sessions"][0]["session_id"] == "session-3"
        assert data["next_cursor"] is None

    @patch("app.cache.cached_query_sessions")
    def test_get_project_sessions_empty(self, mock_cached_query_sessions):
        mock_cached_query_sessions.return_value = []

        response = client.get("/chat/projects/proj-1/sessions", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert len(data["sessions"]) == 0
        assert data["next_cursor"] is None


class TestGetChatHistory:
    @patch("app.routers.chat.get_duckdb_connection")
    @patch("app.routers.chat.get_config")
    def test_get_chat_history_success(self, mock_get_config, mock_get_duckdb):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = "test-bucket"
        mock_get_config.return_value = mock_config

        mock_conn = MagicMock()
        # Format: (message_id, role, content, created_at, updated_at)
        # content is a list of dicts with "text" key
        mock_conn.execute.return_value.fetchall.return_value = [
            ("msg-1", "user", [{"text": "Hello"}], "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"),
            ("msg-2", "assistant", [{"text": "Hi there!"}], "2024-01-01T00:00:01Z", "2024-01-01T00:00:01Z"),
        ]
        mock_get_duckdb.return_value = mock_conn

        response = client.get("/chat/projects/proj-1/sessions/session-1", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == "session-1"
        assert len(data["messages"]) == 2
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][0]["content"] == [{"type": "text", "text": "Hello"}]
        assert data["messages"][1]["role"] == "assistant"
        assert data["messages"][1]["content"] == [{"type": "text", "text": "Hi there!"}]

    @patch("app.routers.chat.get_duckdb_connection")
    @patch("app.routers.chat.get_config")
    def test_get_chat_history_with_image(self, mock_get_config, mock_get_duckdb):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = "test-bucket"
        mock_get_config.return_value = mock_config

        mock_conn = MagicMock()
        mock_conn.execute.return_value.fetchall.return_value = [
            (
                1,
                "user",
                [
                    {"text": "이 이미지를 설명해줘"},
                    {"image": {"format": "png", "source": {"bytes": "base64data"}}},
                ],
                "2024-01-01T00:00:00Z",
                "2024-01-01T00:00:00Z",
            ),
        ]
        mock_get_duckdb.return_value = mock_conn

        response = client.get("/chat/projects/proj-1/sessions/session-1", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert len(data["messages"]) == 1
        assert len(data["messages"][0]["content"]) == 2
        assert data["messages"][0]["content"][0] == {"type": "text", "text": "이 이미지를 설명해줘"}
        assert data["messages"][0]["content"][1] == {
            "type": "image",
            "format": "png",
            "source": "base64data",
            "s3_url": None,
        }

    @patch("app.routers.chat.get_duckdb_connection")
    @patch("app.routers.chat.get_config")
    def test_get_chat_history_empty(self, mock_get_config, mock_get_duckdb):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = "test-bucket"
        mock_get_config.return_value = mock_config

        mock_conn = MagicMock()
        mock_conn.execute.return_value.fetchall.side_effect = Exception("No files found")
        mock_get_duckdb.return_value = mock_conn

        response = client.get("/chat/projects/proj-1/sessions/session-1", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == "session-1"
        assert data["messages"] == []

    @patch("app.routers.chat.get_config")
    def test_get_chat_history_bucket_not_configured(self, mock_get_config):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = None
        mock_get_config.return_value = mock_config

        response = client.get("/chat/projects/proj-1/sessions/session-1", headers={"x-user-id": "user-1"})

        assert response.status_code == 500
        assert response.json()["detail"] == "Session storage bucket not configured"


class TestUpdateSession:
    @patch("app.routers.chat.get_s3_client")
    @patch("app.routers.chat.get_config")
    def test_update_session_success(self, mock_get_config, mock_get_s3_client):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = "test-bucket"
        mock_get_config.return_value = mock_config

        session_data = {
            "session_id": "session-1",
            "session_type": "chat",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-01T00:00:00Z",
            "session_name": None,
        }

        mock_s3 = MagicMock()
        mock_s3.get_object.return_value = {"Body": BytesIO(json.dumps(session_data).encode("utf-8"))}
        mock_get_s3_client.return_value = mock_s3

        response = client.patch(
            "/chat/projects/proj-1/sessions/session-1",
            json={"session_name": "Updated Name"},
            headers={"x-user-id": "user-1"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == "session-1"
        assert data["session_name"] == "Updated Name"

        mock_s3.put_object.assert_called_once()
        call_kwargs = mock_s3.put_object.call_args[1]
        assert call_kwargs["Bucket"] == "test-bucket"
        assert "session_session-1/session.json" in call_kwargs["Key"]
        body = json.loads(call_kwargs["Body"])
        assert body["session_name"] == "Updated Name"

    @patch("app.routers.chat.get_s3_client")
    @patch("app.routers.chat.get_config")
    def test_update_session_not_found(self, mock_get_config, mock_get_s3_client):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = "test-bucket"
        mock_get_config.return_value = mock_config

        mock_s3 = MagicMock()
        mock_s3.exceptions.NoSuchKey = type("NoSuchKey", (Exception,), {})
        mock_s3.get_object.side_effect = mock_s3.exceptions.NoSuchKey("Not found")
        mock_get_s3_client.return_value = mock_s3

        response = client.patch(
            "/chat/projects/proj-1/sessions/nonexistent",
            json={"session_name": "New Name"},
            headers={"x-user-id": "user-1"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Session not found"

    @patch("app.routers.chat.get_config")
    def test_update_session_bucket_not_configured(self, mock_get_config):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = None
        mock_get_config.return_value = mock_config

        response = client.patch(
            "/chat/projects/proj-1/sessions/session-1",
            json={"session_name": "New Name"},
            headers={"x-user-id": "user-1"},
        )

        assert response.status_code == 500
        assert response.json()["detail"] == "Session storage bucket not configured"


class TestDeleteSession:
    @patch("app.routers.chat.delete_s3_prefix")
    @patch("app.routers.chat.get_config")
    def test_delete_session_success(self, mock_get_config, mock_delete_s3_prefix):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = "test-bucket"
        mock_get_config.return_value = mock_config

        mock_delete_s3_prefix.return_value = 5

        response = client.delete("/chat/projects/proj-1/sessions/session-1", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 5

        mock_delete_s3_prefix.assert_called_once_with("test-bucket", "sessions/user-1/proj-1/session_session-1/")

    @patch("app.routers.chat.delete_s3_prefix")
    @patch("app.routers.chat.get_config")
    def test_delete_session_no_files(self, mock_get_config, mock_delete_s3_prefix):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = "test-bucket"
        mock_get_config.return_value = mock_config

        mock_delete_s3_prefix.return_value = 0

        response = client.delete("/chat/projects/proj-1/sessions/session-1", headers={"x-user-id": "user-1"})

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_count"] == 0

    @patch("app.routers.chat.get_config")
    def test_delete_session_bucket_not_configured(self, mock_get_config):
        mock_config = MagicMock()
        mock_config.session_storage_bucket_name = None
        mock_get_config.return_value = mock_config

        response = client.delete("/chat/projects/proj-1/sessions/session-1", headers={"x-user-id": "user-1"})

        assert response.status_code == 500
        assert response.json()["detail"] == "Session storage bucket not configured"
