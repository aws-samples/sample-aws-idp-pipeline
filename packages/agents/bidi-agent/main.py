import asyncio
import json
import logging

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
)

from config import get_config

logger = logging.getLogger(__name__)

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

    try:
        # First message: config (voice, system_prompt)
        config_msg = await websocket.receive_json()
    except (WebSocketDisconnect, json.JSONDecodeError):
        return

    model = BidiNovaSonicModel(
        model_id="amazon.nova-2-sonic-v1:0",
        provider_config={
            "audio": {
                "voice": config_msg.get("voice", "tiffany"),
            },
        },
        client_config={"region": "us-east-1"},
    )

    try:
        timezone = config_msg.get("browser_time_zone", "")
        custom_prompt = config_msg.get("system_prompt")
        system_prompt = custom_prompt or build_system_prompt(timezone)
        await model.start(system_prompt=system_prompt)
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
