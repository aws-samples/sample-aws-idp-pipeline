from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.ddb import client, documents, projects, workflows
from app.ddb.models import DocumentData, ProjectData


class TestMakeKeys:
    def test_make_project_key(self):
        result = projects.make_project_key("proj-123")
        assert result == {"PK": "PROJ#proj-123", "SK": "META"}

    def test_make_document_key(self):
        result = documents.make_document_key("proj-123", "doc-456")
        assert result == {"PK": "PROJ#proj-123", "SK": "DOC#doc-456"}

    def test_make_workflow_key(self):
        result = workflows.make_workflow_key("doc-456", "wf-789")
        assert result == {"PK": "DOC#doc-456", "SK": "WF#wf-789"}

    def test_make_workflow_key_with_entity_type(self):
        result = workflows.make_workflow_key("doc-456", "wf-789", "WEB")
        assert result == {"PK": "WEB#doc-456", "SK": "WF#wf-789"}


class TestProjectHelpers:
    @pytest.fixture
    def mock_table(self):
        with patch("app.ddb.projects.get_table") as mock:
            table = MagicMock()
            mock.return_value = table
            yield table

    def test_get_project_item_found(self, mock_table):
        mock_table.get_item.return_value = {
            "Item": {
                "PK": "PROJ#test-id",
                "SK": "META",
                "data": {"project_id": "test-id", "name": "Test Project", "description": "", "status": "active"},
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
                "GSI1PK": "PROJECTS",
                "GSI1SK": "2024-01-01T00:00:00+00:00",
            }
        }

        result = projects.get_project_item("test-id")

        assert result is not None
        assert result.data.name == "Test Project"
        mock_table.get_item.assert_called_once_with(Key={"PK": "PROJ#test-id", "SK": "META"})

    def test_get_project_item_not_found(self, mock_table):
        mock_table.get_item.return_value = {}

        result = projects.get_project_item("nonexistent")

        assert result is None

    @patch("app.ddb.projects.now_iso", return_value="2024-01-01T00:00:00+00:00")
    def test_put_project_item(self, _, mock_table):
        data = ProjectData(project_id="new-proj", name="New Project", description="", status="active")

        projects.put_project_item("new-proj", data)

        mock_table.put_item.assert_called_once_with(
            Item={
                "PK": "PROJ#new-proj",
                "SK": "META",
                "data": data.model_dump(),
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
                "GSI1PK": "PROJECTS",
                "GSI1SK": "2024-01-01T00:00:00+00:00",
            }
        )

    @patch("app.ddb.projects.now_iso", return_value="2024-01-01T00:00:00+00:00")
    def test_update_project_data(self, _, mock_table):
        data = ProjectData(project_id="test-id", name="Updated Name", description="", status="active")

        projects.update_project_data("test-id", data)

        mock_table.update_item.assert_called_once_with(
            Key={"PK": "PROJ#test-id", "SK": "META"},
            UpdateExpression="SET #data = :data, updated_at = :updated_at, GSI1SK = :gsi1sk",
            ExpressionAttributeNames={"#data": "data"},
            ExpressionAttributeValues={
                ":data": data.model_dump(),
                ":updated_at": "2024-01-01T00:00:00+00:00",
                ":gsi1sk": "2024-01-01T00:00:00+00:00",
            },
        )

    def test_query_all_project_items_single_page(self, mock_table):
        mock_table.query.return_value = {
            "Items": [
                {"PK": "PROJ#test-id", "SK": "PROJ#test-id"},
                {"PK": "PROJ#test-id", "SK": "DOC#doc-1"},
            ]
        }

        result = projects.query_all_project_items("test-id")

        assert len(result) == 2

    def test_query_all_project_items_with_pagination(self, mock_table):
        mock_table.query.side_effect = [
            {"Items": [{"PK": "PROJ#test-id", "SK": "DOC#1"}], "LastEvaluatedKey": {"PK": "PROJ#test-id"}},
            {"Items": [{"PK": "PROJ#test-id", "SK": "DOC#2"}]},
        ]

        result = projects.query_all_project_items("test-id")

        assert len(result) == 2
        assert mock_table.query.call_count == 2


class TestDocumentHelpers:
    @pytest.fixture
    def mock_table(self):
        with patch("app.ddb.documents.get_table") as mock:
            table = MagicMock()
            mock.return_value = table
            yield table

    def test_get_document_item_found(self, mock_table):
        mock_table.get_item.return_value = {
            "Item": {
                "PK": "PROJ#proj-1",
                "SK": "DOC#doc-1",
                "data": {
                    "document_id": "doc-1",
                    "project_id": "proj-1",
                    "name": "test.pdf",
                    "file_type": "application/pdf",
                    "file_size": 1024,
                    "status": "completed",
                    "s3_key": "projects/proj-1/documents/doc-1/test.pdf",
                },
                "GSI1PK": "PROJ#proj-1#DOC",
                "GSI1SK": "2024-01-01T00:00:00+00:00",
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            }
        }

        result = documents.get_document_item("proj-1", "doc-1")

        assert result is not None
        assert result.data.name == "test.pdf"

    def test_get_document_item_not_found(self, mock_table):
        mock_table.get_item.return_value = {}

        result = documents.get_document_item("proj-1", "nonexistent")

        assert result is None

    @patch("app.ddb.documents.now_iso", return_value="2024-01-01T00:00:00+00:00")
    def test_put_document_item(self, _, mock_table):
        data = DocumentData(
            document_id="doc-1",
            project_id="proj-1",
            name="test.pdf",
            file_type="application/pdf",
            file_size=1024,
            status="uploaded",
            s3_key="projects/proj-1/documents/doc-1/test.pdf",
        )

        documents.put_document_item("proj-1", "doc-1", data)

        mock_table.put_item.assert_called_once_with(
            Item={
                "PK": "PROJ#proj-1",
                "SK": "DOC#doc-1",
                "GSI1PK": "PROJ#proj-1#DOC",
                "GSI1SK": "2024-01-01T00:00:00+00:00",
                "data": data.model_dump(),
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T00:00:00+00:00",
            }
        )

    def test_query_documents(self, mock_table):
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
                        "name": "a.pdf",
                        "file_type": "application/pdf",
                        "file_size": 1024,
                        "status": "completed",
                        "s3_key": "test",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                },
                {
                    "PK": "PROJ#proj-1",
                    "SK": "DOC#doc-2",
                    "GSI1PK": "PROJ#proj-1#DOC",
                    "GSI1SK": "2024-01-01T00:00:00+00:00",
                    "data": {
                        "document_id": "doc-2",
                        "project_id": "proj-1",
                        "name": "b.pdf",
                        "file_type": "application/pdf",
                        "file_size": 2048,
                        "status": "completed",
                        "s3_key": "test2",
                    },
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                },
            ]
        }

        result = documents.query_documents("proj-1")

        assert len(result) == 2

    def test_delete_document_item(self, mock_table):
        documents.delete_document_item("proj-1", "doc-1")

        mock_table.delete_item.assert_called_once_with(Key={"PK": "PROJ#proj-1", "SK": "DOC#doc-1"})


class TestWorkflowHelpers:
    @pytest.fixture
    def mock_table(self):
        with patch("app.ddb.workflows.get_table") as mock:
            table = MagicMock()
            mock.return_value = table
            yield table

    def test_get_workflow_item_found(self, mock_table):
        mock_table.get_item.return_value = {
            "Item": {
                "PK": "DOC#doc-1",
                "SK": "WF#wf-1",
                "data": {
                    "execution_arn": "arn:aws:states:us-east-1:123456789012:execution:test:wf-1",
                    "file_name": "test.pdf",
                    "file_type": "application/pdf",
                    "file_uri": "s3://bucket/test.pdf",
                    "project_id": "proj-1",
                    "status": "completed",
                    "total_segments": Decimal("5"),
                },
                "created_at": "2024-01-01T00:00:00+00:00",
                "updated_at": "2024-01-01T01:00:00+00:00",
            }
        }

        result = workflows.get_workflow_item("doc-1", "wf-1")

        assert result is not None
        assert result.data.total_segments == 5
        assert result.data.status == "completed"

    def test_get_workflow_item_not_found(self, mock_table):
        mock_table.get_item.return_value = {}

        result = workflows.get_workflow_item("doc-1", "nonexistent")

        assert result is None

    def test_query_workflows(self, mock_table):
        # query_workflows now queries both DOC and WEB entities
        # First call returns DOC workflows, second call returns empty (no WEB workflows)
        mock_table.query.side_effect = [
            {
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
                        },
                        "created_at": "2024-01-01T00:00:00+00:00",
                        "updated_at": "2024-01-01T01:00:00+00:00",
                    },
                    {
                        "PK": "DOC#doc-1",
                        "SK": "WF#wf-2",
                        "data": {
                            "execution_arn": "arn:aws:states:us-east-1:123456789012:execution:test:wf-2",
                            "file_name": "test2.pdf",
                            "file_type": "application/pdf",
                            "file_uri": "s3://bucket/test2.pdf",
                            "project_id": "proj-1",
                            "status": "pending",
                        },
                        "created_at": "2024-01-02T00:00:00+00:00",
                        "updated_at": "2024-01-02T01:00:00+00:00",
                    },
                ]
            },
            {"Items": []},  # WEB query returns empty
        ]

        result = workflows.query_workflows("doc-1")

        assert len(result) == 2
        assert result[0].data.status == "completed"
        assert result[1].data.status == "pending"

    def test_delete_workflow_item(self, mock_table):
        # Mock query to return empty items (no related STEP/SEG items)
        mock_table.query.return_value = {"Items": []}

        result = workflows.delete_workflow_item("doc-1", "wf-1")

        # delete_workflow_item now tries to delete both DOC and WEB entities
        assert mock_table.delete_item.call_count == 2
        mock_table.delete_item.assert_any_call(Key={"PK": "DOC#doc-1", "SK": "WF#wf-1"})
        mock_table.delete_item.assert_any_call(Key={"PK": "WEB#doc-1", "SK": "WF#wf-1"})
        assert result == 2  # Both DOC and WEB workflow items deleted


class TestBatchDelete:
    @pytest.fixture
    def mock_table(self):
        with patch("app.ddb.client.get_table") as mock:
            table = MagicMock()
            mock.return_value = table
            yield table

    def test_batch_delete_items(self, mock_table):
        mock_batch_writer = MagicMock()
        mock_table.batch_writer.return_value.__enter__ = MagicMock(return_value=mock_batch_writer)
        mock_table.batch_writer.return_value.__exit__ = MagicMock(return_value=False)

        items = [
            {"PK": "PROJ#p1", "SK": "DOC#d1"},
            {"PK": "PROJ#p1", "SK": "DOC#d2"},
        ]

        client.batch_delete_items(items)

        assert mock_batch_writer.delete_item.call_count == 2
