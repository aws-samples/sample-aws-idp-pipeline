"""
Bidirectional Voice Agent - Multi-Model Voice Chat Server

This module provides a FastAPI WebSocket server for real-time bidirectional
voice conversations through AWS Bedrock AgentCore.

=== Architecture ===

Browser (Web Audio API)
    ↕ WebSocket (wss://bedrock-agentcore.../ws)
AWS Bedrock AgentCore (WebSocket Proxy)
    ↕ WebSocket (ws://container:8080/ws)
This Container (bidi-agent)
    ↕ Strands SDK BidiModel
Voice Model (Nova Sonic / Gemini Live / OpenAI Realtime)

=== Supported Models ===

1. Amazon Nova Sonic (nova_sonic)
   - AWS Bedrock native, no API key required
   - Most stable, lowest latency

2. Google Gemini Live (gemini)
   - Requires Google AI API key
   - Model ID: gemini-2.5-flash-native-audio-preview-12-2025

3. OpenAI Realtime (openai)
   - Requires OpenAI API key
   - Model ID: gpt-4o-realtime-preview

=== AgentCore WebSocket Constraints ===

AWS Bedrock AgentCore WebSocket proxy has important limitations:

1. Message Frame Size Limit: 32KB (32,768 bytes)
   - Messages exceeding this limit cause immediate connection termination
   - Audio data increases ~33% when base64 encoded, so be careful

2. Message Frame Rate Limit: 250 frames per second
   - Be cautious with high-speed audio streaming

3. Idle Session Timeout: Default 900 seconds (15 minutes)
   - Configurable via LifecycleConfiguration (60s ~ 28800s)

=== Audio Chunking Strategy ===

OpenAI/Gemini can send larger audio chunks than Nova Sonic.
Example: OpenAI sends 40KB+ audio chunk → Exceeds AgentCore 32KB limit → Connection drops

Solution: Split into 24KB chunks
- 24KB audio + JSON overhead (~52 bytes) = ~24KB < 32KB limit
- Base64-encoded audio is already a string, no additional encoding needed

Reference: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-websocket.html
"""

import asyncio
import json
import logging
import sys
from datetime import datetime, timezone

import boto3

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

# Configure logging to stdout for CloudWatch
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
    force=True,
)

# Startup verification log
print("=" * 50, flush=True)
print("[BIDI-AGENT] Module loaded - logging initialized", flush=True)
print(f"[BIDI-AGENT] Python buffering: PYTHONUNBUFFERED={__import__('os').environ.get('PYTHONUNBUFFERED', 'NOT SET')}", flush=True)
print("=" * 50, flush=True)

from strands.experimental.bidi.models.model import BidiModelTimeoutError
from websockets.exceptions import ConnectionClosedError
from strands.experimental.bidi.types.events import (
    BidiTextInputEvent,
    BidiAudioInputEvent,
    BidiAudioStreamEvent,
    BidiTranscriptStreamEvent,
    BidiConnectionStartEvent,
    BidiResponseStartEvent,
    BidiResponseCompleteEvent,
    BidiInterruptionEvent,
    BidiErrorEvent,
    ToolUseStreamEvent,
)
from strands.session import S3SessionManager
from strands.types.content import ContentBlock, Message
from strands.types.session import SessionMessage
from strands.types._events import ToolResultEvent

from config import get_config, create_bidi_model
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
        model_type: str = "nova_sonic",
    ):
        self.session_id = session_id
        self.message_index = 0
        self.enabled = bool(bucket and user_id and project_id and session_id)
        # Store agent_id with model type for distinguishing voice sessions
        # e.g., "voice_nova_sonic", "voice_gemini", "voice_openai"
        self.agent_id = f"voice_{model_type}"

        if self.enabled:
            prefix = f"sessions/{user_id}/{project_id}"
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
                agent_id=self.agent_id,
                session_message=session_message,
            )
            logger.debug(f"Saved transcript message_{self.message_index}")
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
        logger.warning(f"Failed to fetch voice system prompt: {e}")
        return None


def build_system_prompt(timezone: str) -> str:
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
    logger.info("WebSocket connection accepted")
    config = get_config()

    try:
        config_msg = await websocket.receive_json()
        logger.info(
            f"Session started: voice={config_msg.get('voice')}, "
            f"timezone={config_msg.get('browser_time_zone')}"
        )
    except (WebSocketDisconnect, json.JSONDecodeError) as e:
        logger.warning(f"Failed to receive config: {e}")
        return

    # Create model based on user selection
    model_type = config_msg.get("model_type", "nova_sonic")

    # Create transcript saver for persisting voice messages
    # Includes model_type in agent_id to distinguish sessions (e.g., voice_nova_sonic)
    transcript_saver = TranscriptSaver(
        bucket=config.session_storage_bucket_name,
        user_id=config_msg.get("user_id", ""),
        project_id=config_msg.get("project_id", ""),
        session_id=config_msg.get("session_id", ""),
        model_type=model_type,
    )
    if transcript_saver.enabled:
        logger.info(f"Transcript saving enabled for session {config_msg.get('session_id')} ({transcript_saver.agent_id})")
    api_key = config_msg.get("api_key")
    voice = config_msg.get("voice", "tiffany")

    try:
        model = create_bidi_model(
            model_type=model_type,
            api_key=api_key,
            voice=voice,
        )
        logger.info(f"Created {model_type} model")
    except ValueError as e:
        logger.error(f"Failed to create model: {e}")
        await websocket.close(code=1011, reason=str(e))
        return

    user_timezone = config_msg.get("browser_time_zone", "UTC")

    try:
        custom_prompt = config_msg.get("system_prompt")
        system_prompt = custom_prompt or build_system_prompt(user_timezone)
        tools = get_tools()
        logger.info(f"Starting model with {len(tools)} tools: {[t['name'] for t in tools]}")
        await model.start(system_prompt=system_prompt, tools=tools)
        logger.info("voice model started successfully")
    except Exception:
        logger.exception("Failed to start voice model")
        await websocket.close(code=1011, reason="Failed to start model")
        return

    async def browser_to_bedrock():
        """Forward messages from browser WebSocket to voice model."""
        msg_count = 0
        try:
            async for msg in websocket.iter_json():
                msg_count += 1
                msg_type = msg.get("type")
                if msg_type == "text":
                    logger.info(f"[b2b] Text message #{msg_count}")
                    await model.send(BidiTextInputEvent(text=msg["text"]))
                elif msg_type == "audio":
                    if msg_count <= 5 or msg_count % 100 == 0:
                        logger.debug(f"[b2b] Audio chunk #{msg_count}")
                    await model.send(
                        BidiAudioInputEvent(
                            audio=msg["audio"],
                            format="pcm",
                            sample_rate=16000,
                            channels=1,
                        )
                    )
                elif msg_type == "ping":
                    # Keep-alive ping from browser, respond with pong
                    logger.debug(f"[b2b] Ping received, sending pong (msg #{msg_count})")
                    await websocket.send_json({"type": "pong"})
                elif msg_type == "stop":
                    logger.info(f"[b2b] Stop received after {msg_count} messages")
                    break
            logger.info(f"[b2b] Loop ended after {msg_count} messages")
        except WebSocketDisconnect:
            logger.info(f"[b2b] WebSocket disconnected after {msg_count} messages")

    async def bedrock_to_browser():
        """Forward events from voice model to browser WebSocket."""
        processed_tool_use_ids: set[str] = set()
        event_count = 0

        try:
            logger.info("[b2b2] Starting model.receive() loop")
            async for event in model.receive():
                event_count += 1
                if event_count <= 10 or event_count % 50 == 0:
                    logger.info(f"Event #{event_count}: {type(event).__name__}")
                if isinstance(event, BidiAudioStreamEvent):
                    # =============================================================
                    # Audio Chunking for AgentCore Compatibility
                    # =============================================================
                    #
                    # Problem:
                    # AWS Bedrock AgentCore WebSocket proxy has a 32KB message frame limit.
                    # OpenAI/Gemini Realtime APIs send variable-size audio chunks,
                    # sometimes exceeding 40KB per chunk.
                    # Exceeding the 32KB limit causes AgentCore to immediately terminate
                    # the WebSocket connection.
                    #
                    # Solution:
                    # Split large audio data into smaller chunks under 24KB.
                    #
                    # Why 24KB?
                    # - AgentCore limit: 32KB (32,768 bytes)
                    # - JSON overhead: {"type":"audio","audio":"...","sample_rate":24000}
                    #   adds approximately 50-100 bytes
                    # - Safety margin: 24KB + JSON overhead ≈ 24-25KB << 32KB limit
                    # - Audio data is already base64-encoded string from the model
                    #
                    # Notes:
                    # - Nova Sonic is Bedrock-native and optimized for small chunks
                    # - OpenAI/Gemini are external APIs with irregular chunk sizes
                    # - Browser-side AudioPlayback automatically queues and plays
                    #   sequential chunks seamlessly
                    # =============================================================
                    MAX_AUDIO_CHUNK_SIZE = 24000  # 24KB (considering AgentCore 32KB limit)
                    audio_data = event.audio or ""
                    sample_rate = event.sample_rate

                    if len(audio_data) <= MAX_AUDIO_CHUNK_SIZE:
                        # Small enough to send as-is
                        await websocket.send_json({
                            "type": "audio",
                            "audio": audio_data,
                            "sample_rate": sample_rate,
                        })
                    else:
                        # Split large audio into chunks
                        # Browser's AudioPlayback queues and plays them sequentially
                        for i in range(0, len(audio_data), MAX_AUDIO_CHUNK_SIZE):
                            chunk = audio_data[i:i + MAX_AUDIO_CHUNK_SIZE]
                            await websocket.send_json({
                                "type": "audio",
                                "audio": chunk,
                                "sample_rate": sample_rate,
                            })
                elif isinstance(event, BidiTranscriptStreamEvent):
                    await websocket.send_json(
                        {
                            "type": "transcript",
                            "text": event.text,
                            "role": event.role,
                            "is_final": event.is_final,
                        }
                    )
                    if event.is_final and event.text.strip():
                        transcript_saver.save_transcript(event.role, event.text)
                elif isinstance(event, ToolUseStreamEvent):
                    # Handle tool use requests from the model
                    tool_use = (
                        getattr(event, "current_tool_use", None)
                        or getattr(event, "tool_use", None)
                        or (event.get("current_tool_use") if hasattr(event, "get") else None)
                    )
                    if tool_use:
                        tool_use_id = tool_use.get("toolUseId")
                        tool_input = tool_use.get("input")
                        if (
                            tool_use_id
                            and tool_use_id not in processed_tool_use_ids
                            and tool_input is not None
                        ):
                            processed_tool_use_ids.add(tool_use_id)
                            tool_name = tool_use.get("name")
                            logger.info(f"Tool use: {tool_name} (id: {tool_use_id})")

                            await websocket.send_json(
                                {
                                    "type": "tool_use",
                                    "tool_name": tool_name,
                                    "tool_use_id": tool_use_id,
                                }
                            )

                            try:
                                tool_context = {
                                    "timezone": user_timezone,
                                    "project_id": config_msg.get("project_id"),
                                    "session_id": config_msg.get("session_id"),
                                    "user_id": config_msg.get("user_id"),
                                }
                                tool_result = await execute_tool(tool_use, tool_context)
                                logger.info(f"Tool result: {tool_name} -> {tool_result.get('status')}")
                                await model.send(ToolResultEvent(tool_result))

                                await websocket.send_json(
                                    {
                                        "type": "tool_result",
                                        "tool_name": tool_name,
                                        "tool_use_id": tool_use_id,
                                        "status": tool_result.get("status"),
                                    }
                                )
                            except Exception as e:
                                logger.exception(f"Tool execution error: {tool_name}")
                                error_result = {
                                    "toolUseId": tool_use_id,
                                    "status": "error",
                                    "content": [{"text": f"Tool execution error: {str(e)}"}],
                                }
                                try:
                                    await model.send(ToolResultEvent(error_result))
                                except Exception:
                                    logger.exception("Failed to send error result")
                                await websocket.send_json(
                                    {
                                        "type": "tool_result",
                                        "tool_name": tool_name,
                                        "tool_use_id": tool_use_id,
                                        "status": "error",
                                        "error": str(e),
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
                elif isinstance(event, BidiErrorEvent):
                    error_msg = getattr(event, 'message', None) or getattr(event, 'error', None) or str(event)
                    logger.error(f"BidiErrorEvent received: {error_msg}")
                    await websocket.send_json(
                        {
                            "type": "error",
                            "message": str(error_msg),
                        }
                    )
                else:
                    # Log unknown event types for debugging
                    logger.debug(f"Unknown event type: {type(event).__name__}: {event}")
            logger.info(f"[b2b2] model.receive() loop ended NORMALLY after {event_count} events")
        except WebSocketDisconnect:
            logger.info(f"WebSocket disconnected after {event_count} events")
        except BidiModelTimeoutError:
            logger.info("Voice chat session timed out due to inactivity")
            try:
                await websocket.send_json({
                    "type": "timeout",
                    "reason": "Session timed out due to inactivity",
                })
            except Exception:
                pass
        except ConnectionClosedError as e:
            logger.warning(f"Model WebSocket closed unexpectedly after {event_count} events: {e}")
            try:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Model connection closed: {e}",
                })
            except Exception:
                pass
        except RuntimeError as e:
            # Handle "websocket.send after close" errors gracefully
            error_str = str(e).lower()
            if "websocket" in error_str or "closed" in error_str:
                logger.info(f"WebSocket closed while sending (after {event_count} events): {e}")
            else:
                logger.exception(f"Runtime error in bedrock_to_browser after {event_count} events")
        except Exception:
            logger.exception(f"Error in bedrock_to_browser after {event_count} events")

    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(browser_to_bedrock())
            tg.create_task(bedrock_to_browser())
    except* WebSocketDisconnect:
        logger.info("TaskGroup: WebSocketDisconnect")
    except* Exception as eg:
        for exc in eg.exceptions:
            logger.error(f"TaskGroup exception: {type(exc).__name__}: {exc}")
    finally:
        logger.info("Stopping model...")
        try:
            await model.stop()
            logger.info("Model stopped successfully")
        except Exception as e:
            logger.error(f"Error stopping model: {e}")
        logger.info("Session ended")
