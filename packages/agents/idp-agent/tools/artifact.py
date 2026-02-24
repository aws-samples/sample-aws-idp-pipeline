from nanoid import generate as nanoid_generate
from strands import tool

from config import get_config

NANOID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_"


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
            Dictionary with bucket, key, and artifact markdown reference.
        """
        config = get_config()
        artifact_id = f"art_{nanoid_generate(NANOID_ALPHABET, 12)}"
        key = f"{user_id}/{project_id}/artifacts/{artifact_id}/{filename}"

        return {
            "bucket": config.agent_storage_bucket_name,
            "key": key,
            "artifact_ref": f"[artifact:{artifact_id}]({filename})",
        }

    return artifact_path
