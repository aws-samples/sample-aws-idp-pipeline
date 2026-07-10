import os
from urllib.parse import urlparse

import boto3
from nanoid import generate as nanoid_generate
from strands import tool

from config import get_config

NANOID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_"

# officecli operates on local files only, so documents must be staged on the
# runtime container's local filesystem before/after editing. This local storage
# is ephemeral scratch space (AgentCore /tmp is volatile and reused across
# sessions) — S3 is the source of truth. Every document task gets its own
# unique workspace under this root to avoid path collisions between concurrent
# requests sharing a microVM.
LOCAL_WORK_ROOT = "/tmp/officecli"


def create_artifact_path_tool(
    user_id: str | None = None,
    project_id: str | None = None,
):
    """Create an artifact_path tool bound to user/project context."""

    @tool
    def artifact_path(filename: str) -> dict:
        """Generate S3 artifact path for uploading files created in code_interpreter.

        Call this tool BEFORE uploading a file from code_interpreter to get the
        correct S3 bucket and key.

        Args:
            filename: The filename to upload (e.g., "report.docx")

        Returns:
            Dictionary with s3_uri, bucket, key, and artifact markdown reference.
        """
        config = get_config()
        artifact_id = f"art_{nanoid_generate(NANOID_ALPHABET, 12)}"
        bucket = config.agent_storage_bucket_name
        key = f"{user_id}/{project_id}/artifacts/{artifact_id}/{filename}"

        return {
            "s3_uri": f"s3://{bucket}/{key}",
            "bucket": bucket,
            "key": key,
            "artifact_ref": f"[artifact:{artifact_id}]({filename})",
        }

    return artifact_path


def create_artifact_workspace_tool(session_id: str):
    """Create an artifact_workspace tool bound to the session."""

    @tool
    def artifact_workspace() -> dict:
        """Create a fresh local workspace directory for an officecli document task.

        Call this FIRST for any officecli document task (creating a new document
        or editing an existing one). It returns a unique, isolated directory to
        use as the working directory — create/download files there and let
        officecli read/write them there. This avoids path collisions between
        concurrent requests.

        Local files are ephemeral scratch space: complete the
        workspace -> edit -> artifact_upload flow within a single turn. Do not
        rely on files persisting across turns — S3 is the source of truth.

        Returns:
            Dictionary with workspace_dir to place and edit files in.
        """
        workspace_id = nanoid_generate(NANOID_ALPHABET, 12)
        workspace_dir = os.path.join(LOCAL_WORK_ROOT, session_id, workspace_id)
        os.makedirs(workspace_dir, exist_ok=True)

        return {"workspace_dir": workspace_dir}

    return artifact_workspace


def create_artifact_download_tool():
    """Create an artifact_download tool for staging S3 artifacts locally."""

    @tool
    def artifact_download(s3_uri: str, workspace_dir: str) -> dict:
        """Download an artifact from S3 into a workspace directory for editing.

        officecli operates on local files only. Call this to stage an existing
        artifact locally before editing it with officecli, then upload the
        result with artifact_upload. Get workspace_dir from artifact_workspace.

        Args:
            s3_uri: The S3 URI of the artifact (e.g., "s3://bucket/key/file.pptx").
            workspace_dir: The workspace directory from artifact_workspace.

        Returns:
            Dictionary with local_path pointing to the downloaded file.
        """
        parsed = urlparse(s3_uri)
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        filename = os.path.basename(key)

        local_path = os.path.join(workspace_dir, filename)

        s3 = boto3.client("s3")
        s3.download_file(bucket, key, local_path)

        return {"local_path": local_path, "s3_uri": s3_uri}

    return artifact_download


def create_artifact_upload_tool(
    user_id: str | None = None,
    project_id: str | None = None,
):
    """Create an artifact_upload tool bound to user/project context."""

    @tool
    def artifact_upload(local_path: str) -> dict:
        """Upload a locally created/edited file to S3 as a project artifact.

        Call this after creating or editing a document with officecli to publish
        it. Returns the artifact_ref to report back to the user.

        Args:
            local_path: Path to the local file to upload (e.g., "/tmp/officecli/deck.pptx").

        Returns:
            Dictionary with s3_uri, bucket, key, and artifact markdown reference.
        """
        config = get_config()
        filename = os.path.basename(local_path)
        artifact_id = f"art_{nanoid_generate(NANOID_ALPHABET, 12)}"
        bucket = config.agent_storage_bucket_name
        key = f"{user_id}/{project_id}/artifacts/{artifact_id}/{filename}"

        s3 = boto3.client("s3")
        s3.upload_file(local_path, bucket, key)

        return {
            "s3_uri": f"s3://{bucket}/{key}",
            "bucket": bucket,
            "key": key,
            "artifact_ref": f"[artifact:{artifact_id}]({filename})",
        }

    return artifact_upload
