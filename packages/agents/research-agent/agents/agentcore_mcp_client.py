import hashlib
from collections.abc import Generator
from typing import Any

import httpx
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp.mcp_client import MCPClient


class SigV4HTTPXAuth(httpx.Auth):
    """HTTPX Auth class that signs requests with AWS SigV4."""

    def __init__(self, credentials: Any, region: str):
        self.credentials = credentials
        self.service = "bedrock-agentcore"
        self.region = region
        self.signer = SigV4Auth(credentials, self.service, region)

    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        headers = dict(request.headers)

        headers.pop("connection", None)
        headers["x-amz-content-sha256"] = hashlib.sha256(request.content if request.content else b"").hexdigest()

        aws_request = AWSRequest(
            method=request.method,
            url=str(request.url),
            data=request.content,
            headers=headers,
        )

        self.signer.add_auth(aws_request)

        request.headers.clear()
        request.headers.update(dict(aws_request.headers))

        yield request


class AgentCoreGatewayMCPClient:
    """Factory for clients to call MCP Gateway hosted on Bedrock AgentCore"""

    @staticmethod
    def with_iam_auth(gateway_url: str, credentials: Any, region: str) -> MCPClient:
        """Create an MCP client with IAM (SigV4) authentication."""
        return MCPClient(
            lambda: streamablehttp_client(
                gateway_url,
                auth=SigV4HTTPXAuth(credentials, region),
                timeout=120,
                terminate_on_close=False,
            )
        )
