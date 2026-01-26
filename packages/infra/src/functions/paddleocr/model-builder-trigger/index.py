"""CodeBuild Trigger Lambda for PaddleOCR Model Builder

Uses async pattern:
- on_event: Starts CodeBuild and returns immediately
- is_complete: Polls for CodeBuild completion
"""
import json
import boto3


def on_event(event, context):
    """Start CodeBuild and return immediately."""
    print(f"on_event: {json.dumps(event)}")

    request_type = event.get("RequestType")
    props = event.get("ResourceProperties", {})
    project_name = props.get("ProjectName")

    if request_type == "Delete":
        return {"PhysicalResourceId": event.get("PhysicalResourceId", "model-builder")}

    if request_type in ("Create", "Update"):
        codebuild = boto3.client("codebuild")

        print(f"Starting CodeBuild project: {project_name}")
        response = codebuild.start_build(projectName=project_name)
        build_id = response["build"]["id"]
        print(f"Build started: {build_id}")

        return {
            "PhysicalResourceId": build_id,
            "Data": {"BuildId": build_id}
        }

    return {"PhysicalResourceId": event.get("PhysicalResourceId", "model-builder")}


def is_complete(event, context):
    """Check if CodeBuild is complete."""
    print(f"is_complete: {json.dumps(event)}")

    request_type = event.get("RequestType")

    if request_type == "Delete":
        return {"IsComplete": True}

    build_id = event.get("PhysicalResourceId")
    if not build_id or build_id == "model-builder":
        return {"IsComplete": True}

    codebuild = boto3.client("codebuild")
    build_response = codebuild.batch_get_builds(ids=[build_id])

    if not build_response.get("builds"):
        return {"IsComplete": True}

    build = build_response["builds"][0]
    status = build["buildStatus"]
    print(f"Build status: {status}")

    if status == "SUCCEEDED":
        return {
            "IsComplete": True,
            "Data": {"Status": "SUCCEEDED", "BuildId": build_id}
        }
    elif status in ("FAILED", "FAULT", "STOPPED", "TIMED_OUT"):
        raise Exception(f"Build failed with status: {status}")
    else:
        # Still in progress
        return {"IsComplete": False}
