import asyncio
import json
import logging
from datetime import datetime, timezone

import boto3

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from strands.experimental.bidi.models import BidiNovaSonicModel
from strands.experimental.bidi.types.events import (
    BidiTextInputEvent,
    BidiAudioInputEvent,
    BidiAudioStreamEvent,
    BidiTranscriptStreamEvent,
    BidiConnectionStartEvent,
    BidiResponseStartEvent,
    BidiResponseCompleteEvent,
    BidiInterruptionEvent,
    ToolUseStreamEvent,
)
from strands.session import S3SessionManager
from strands.types.content import ContentBlock, Message
from strands.types.session import SessionMessage
from strands.types._events import ToolResultEvent

from config import get_config
from tools import get_tools, execute_tool

logger = logging.getLogger(__name__)


class TranscriptSaver:
    """Save voice transcripts to S3 using Strands SDK S3SessionManager."""

    def __init__(
        self,
        bucket: str,
        user_id: str,
        project_id: str,
        session_id: str,
    ):
        self.session_id = session_id
        self.message_index = 0
        self.enabled = bool(bucket and user_id and project_id and session_id)

        if self.enabled:
            prefix = f"sessions/{user_id}/{project_id}"
            # SDK가 자동으로 session.json 생성 (채팅과 동일)
            self.session_manager = S3SessionManager(
                session_id=session_id,
                bucket=bucket,
                prefix=prefix,
            )
        else:
            self.session_manager = None

    def save_transcript(self, role: str, text: str) -> None:
        """Save a transcript message to S3 using SDK."""
        if not self.enabled or not self.session_manager:
            return

        now = datetime.now(timezone.utc).isoformat()

        try:
            message = Message(
                role=role,
                content=[ContentBlock(text=text)],
            )
            session_message = SessionMessage(
                message=message,
                message_id=self.message_index,
                created_at=now,
                updated_at=now,
            )
            self.session_manager.create_message(
                session_id=self.session_id,
                agent_id="voice",
                session_message=session_message,
            )
            logger.info(f"Saved transcript message_{self.message_index}")
            self.message_index += 1
        except Exception as e:
            logger.error(f"Failed to save transcript: {e}")

TIMEZONE_TO_LANGUAGE: dict[str, str] = {
    "Asia/Seoul": "Korean",
    "Asia/Tokyo": "Japanese",
    "Asia/Shanghai": "Chinese",
    "Asia/Kolkata": "Hindi",
    "Asia/Calcutta": "Hindi",
    "Europe/Paris": "French",
    "Europe/Berlin": "German",
    "Europe/Rome": "Italian",
    "Europe/Madrid": "Spanish",
    "America/Sao_Paulo": "Portuguese",
    "America/Mexico_City": "Spanish",
}

BASE_SYSTEM_PROMPT = """You are a warm, professional, and helpful female AI voice assistant. \
Your primary purpose is to have natural, conversational voice interactions with users in their preferred language.

Core Principles:
- Natural Conversation: Speak like a helpful friend, not a lecture. Be direct and human.
- Brevity: Keep responses concise (3-5 sentences). Start with the answer, then expand only if needed.
- Active Listening: Pay close attention to what the user says, including context from earlier in the conversation.

Response Style:
- Start by directly answering the user's question in 1-2 sentences
- Use conversational language appropriate for spoken dialogue
- Short sentences work better for voice

Korean Language Understanding:
- When the user speaks Korean, expect Korean phonemes, grammar patterns, and sentence structures
- Korean speakers often use English loanwords - recognize these patterns
- Use conversation context to improve understanding
- If you hear syllables that could be Korean, interpret them as Korean first"""

LANGUAGE_MIRROR_PROMPT = """
CRITICAL LANGUAGE MIRRORING RULES:
- Always reply in the language spoken. DO NOT mix with English. However, if the user talks in English, reply in English.
- Please respond in the language the user is talking to you in, If you have a question or suggestion, ask it in the language the user is talking in. I want to ensure that our communication remains in the same language as the user."""


def fetch_voice_system_prompt() -> str | None:
    """Fetch voice system prompt from S3."""
    config = get_config()
    if not config.agent_storage_bucket_name:
        return None

    s3 = boto3.client("s3")
    key = "__prompts/voice_system_prompt.txt"

    try:
        response = s3.get_object(
            Bucket=config.agent_storage_bucket_name,
            Key=key,
        )
        return response["Body"].read().decode("utf-8")
    except Exception as e:
        logger.error(f"Failed to fetch voice system prompt: {e}")
        return None


def build_system_prompt(timezone: str) -> str:
    # Try to fetch from S3 first
    base_prompt = fetch_voice_system_prompt() or BASE_SYSTEM_PROMPT

    language = TIMEZONE_TO_LANGUAGE.get(timezone)
    if language:
        return (
            f"{base_prompt}\n\n"
            f"The user's timezone is {timezone}. "
            f"Default to {language} unless the user speaks a different language.\n"
            f"{LANGUAGE_MIRROR_PROMPT}"
        )
    return f"{base_prompt}\n{LANGUAGE_MIRROR_PROMPT}"


app = FastAPI()


@app.get("/ping")
async def ping():
    return {"status": "healthy"}


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    config = get_config()

    try:
        # First message: config (voice, system_prompt, session info)
        config_msg = await websocket.receive_json()
    except (WebSocketDisconnect, json.JSONDecodeError):
        return

    # Create transcript saver for persisting voice messages
    transcript_saver = TranscriptSaver(
        bucket=config.session_storage_bucket_name,
        user_id=config_msg.get("user_id", ""),
        project_id=config_msg.get("project_id", ""),
        session_id=config_msg.get("session_id", ""),
    )
    if transcript_saver.enabled:
        logger.info(
            f"Transcript saving enabled for session {config_msg.get('session_id')}"
        )

    model = BidiNovaSonicModel(
        model_id="amazon.nova-2-sonic-v1:0",
        provider_config={
            "audio": {
                "voice": config_msg.get("voice", "tiffany"),
            },
        },
        client_config={"region": "us-east-1"},
    )

    # Get user's timezone for tool execution
    user_timezone = config_msg.get("browser_time_zone", "UTC")

    try:
        custom_prompt = config_msg.get("system_prompt")
        system_prompt = custom_prompt or build_system_prompt(user_timezone)
        await model.start(system_prompt=system_prompt, tools=get_tools())
    except Exception:
        logger.exception("Failed to start BidiNovaSonicModel")
        await websocket.close(code=1011, reason="Failed to start model")
        return

    async def browser_to_bedrock():
        """Forward messages from browser WebSocket to BidiNovaSonicModel."""
        try:
            async for msg in websocket.iter_json():
                msg_type = msg.get("type")
                if msg_type == "text":
                    await model.send(BidiTextInputEvent(text=msg["text"]))
                elif msg_type == "audio":
                    await model.send(
                        BidiAudioInputEvent(
                            audio=msg["audio"],
                            format="pcm",
                            sample_rate=16000,
                            channels=1,
                        )
                    )
                elif msg_type == "stop":
                    break
        except WebSocketDisconnect:
            pass

    async def bedrock_to_browser():
        """Forward events from BidiNovaSonicModel to browser WebSocket."""
        processed_tool_use_ids: set[str] = set()

        try:
            async for event in model.receive():
                if isinstance(event, BidiAudioStreamEvent):
                    await websocket.send_json(
                        {
                            "type": "audio",
                            "audio": event.audio,
                            "sample_rate": event.sample_rate,
                        }
                    )
                elif isinstance(event, BidiTranscriptStreamEvent):
                    await websocket.send_json(
                        {
                            "type": "transcript",
                            "text": event.text,
                            "role": event.role,
                            "is_final": event.is_final,
                        }
                    )
                    # Save final transcripts to S3
                    if event.is_final and event.text.strip():
                        transcript_saver.save_transcript(event.role, event.text)
                elif isinstance(event, ToolUseStreamEvent):
                    # Handle tool use requests from the model
                    tool_use = event.current_tool_use
                    if tool_use:
                        tool_use_id = tool_use.get("toolUseId")
                        tool_input = tool_use.get("input")
                        # Only process complete tool uses that haven't been processed
                        if (
                            tool_use_id
                            and tool_use_id not in processed_tool_use_ids
                            and tool_input is not None
                        ):
                            processed_tool_use_ids.add(tool_use_id)
                            logger.info(
                                f"Tool use detected: {tool_use.get('name')} (id: {tool_use_id})"
                            )

                            # Notify browser about tool use
                            await websocket.send_json(
                                {
                                    "type": "tool_use",
                                    "tool_name": tool_use.get("name"),
                                    "tool_use_id": tool_use_id,
                                }
                            )

                            # Execute tool and send result back to model
                            tool_context = {"timezone": user_timezone}
                            tool_result = await execute_tool(tool_use, tool_context)
                            await model.send(ToolResultEvent(tool_result))

                            # Notify browser about tool result
                            await websocket.send_json(
                                {
                                    "type": "tool_result",
                                    "tool_name": tool_use.get("name"),
                                    "tool_use_id": tool_use_id,
                                    "status": tool_result.get("status"),
                                }
                            )
                elif isinstance(event, BidiConnectionStartEvent):
                    await websocket.send_json(
                        {
                            "type": "connection_start",
                            "connection_id": event.connection_id,
                        }
                    )
                elif isinstance(event, BidiResponseStartEvent):
                    await websocket.send_json({"type": "response_start"})
                elif isinstance(event, BidiResponseCompleteEvent):
                    await websocket.send_json({"type": "response_complete"})
                elif isinstance(event, BidiInterruptionEvent):
                    await websocket.send_json(
                        {
                            "type": "interruption",
                            "reason": event.reason,
                        }
                    )
        except WebSocketDisconnect:
            pass

    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(browser_to_bedrock())
            tg.create_task(bedrock_to_browser())
    except* WebSocketDisconnect:
        pass
    finally:
        await model.stop()
