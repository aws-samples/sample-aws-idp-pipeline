"""
Bidirectional Voice Model Configuration

This module provides configuration and factory functions for multi-model voice support.

=== Model Comparison ===

| Feature           | Nova Sonic          | Gemini Live           | OpenAI Realtime      |
|-------------------|---------------------|-----------------------|----------------------|
| Provider          | AWS Bedrock         | Google AI             | OpenAI               |
| API Key Required  | No (IAM Role)       | Yes                   | Yes                  |
| Network           | AWS Internal        | External API          | External API         |
| Latency           | Low                 | Medium                | Medium               |
| Audio Chunk Size  | Small & Consistent  | Variable (can be big) | Variable (can be big)|
| Tool Support      | Yes                 | Yes                   | Yes                  |

=== Important Notes ===

1. API Key Management for OpenAI/Gemini
   - API keys are stored in browser localStorage (client-side only)
   - Not stored on server (security: client manages their own keys)
   - Passed via WebSocket config message for each session

2. Audio Chunk Size Issue
   - AgentCore WebSocket proxy: 32KB message frame limit
   - Nova Sonic: Optimized for Bedrock, sends small chunks
   - OpenAI/Gemini: Can send large chunks → Must split to 24KB in main.py

3. Voice Options by Model
   - Nova Sonic: tiffany (female), matthew (male)
   - Gemini: Kore, Puck, Charon, Fenrir, Aoede
   - OpenAI: alloy, ash, ballad, coral, echo, sage, shimmer, verse
"""

import logging
import os
from enum import Enum
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class BidiModelType(str, Enum):
    """Supported bidirectional voice model types."""

    NOVA_SONIC = "nova_sonic"  # AWS Bedrock Nova Sonic (default, no API key needed)
    GEMINI = "gemini"  # Google Gemini Live (API key required)
    OPENAI = "openai"  # OpenAI Realtime (API key required)


class Config(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.local", env_file_encoding="utf-8", extra="ignore"
    )

    aws_region: str = "us-east-1"
    agent_storage_bucket_name: str = ""
    session_storage_bucket_name: str = ""
    mcp_gateway_url: str = ""


@lru_cache
def get_config() -> Config:
    return Config()


def create_bidi_model(
    model_type: str,
    api_key: str | None = None,
    voice: str = "tiffany",
):
    """
    Factory function: Creates the appropriate BidiModel instance based on model type.

    Uses Strands SDK's BidiModel abstraction to provide a unified interface
    for various voice AI models.

    Args:
        model_type: Model type ("nova_sonic", "gemini", "openai")
        api_key: API key for Gemini/OpenAI (Nova Sonic uses IAM Role)
        voice: Voice identifier (varies by model)

    Returns:
        BidiModel instance (BidiNovaSonicModel, BidiGeminiLiveModel, or BidiOpenAIRealtimeModel)

    Raises:
        ValueError: Unknown model type or missing required API key

    Examples:
        # Nova Sonic (no API key needed)
        model = create_bidi_model("nova_sonic", voice="tiffany")

        # Gemini Live (API key required)
        model = create_bidi_model("gemini", api_key="AIza...", voice="Kore")

        # OpenAI Realtime (API key required)
        model = create_bidi_model("openai", api_key="sk-...", voice="alloy")
    """
    config = get_config()

    # =========================================================================
    # Nova Sonic - AWS Bedrock Native Model
    # =========================================================================
    # - No API key needed (authenticates via container's IAM Role)
    # - Low latency via AWS internal network
    # - Optimized for small audio chunks, no AgentCore 32KB limit issues
    if model_type == BidiModelType.NOVA_SONIC or model_type == "nova_sonic":
        from strands.experimental.bidi.models import BidiNovaSonicModel

        # Validate Nova Sonic voice option (defaults to tiffany if invalid)
        nova_voice = voice if voice in ["tiffany", "matthew"] else "tiffany"
        logger.info(f"Creating nova_sonic model with voice={nova_voice}")
        return BidiNovaSonicModel(
            model_id="amazon.nova-2-sonic-v1:0",
            provider_config={
                "audio": {"voice": nova_voice},
            },
            client_config={"region": config.aws_region},
        )

    # =========================================================================
    # Gemini Live - Google AI Model
    # =========================================================================
    # - Requires Google AI API key (passed from browser localStorage)
    # - Higher latency due to external network calls
    # - Can send large audio chunks → Must split to 24KB in main.py
    elif model_type == BidiModelType.GEMINI or model_type == "gemini":
        from strands.experimental.bidi.models import BidiGeminiLiveModel

        if not api_key:
            raise ValueError("API key is required for Gemini model")

        # Validate Gemini voice option (defaults to Kore if invalid)
        gemini_voice = voice if voice in ["Puck", "Charon", "Kore", "Fenrir", "Aoede"] else "Kore"
        logger.info(f"Creating Gemini model with voice={gemini_voice}")

        return BidiGeminiLiveModel(
            model_id="gemini-2.5-flash-native-audio-preview-12-2025",
            provider_config={
                "audio": {"voice": gemini_voice},
            },
            client_config={"api_key": api_key},
        )

    # =========================================================================
    # OpenAI Realtime - OpenAI Model
    # =========================================================================
    # - Requires OpenAI API key (passed from browser localStorage)
    # - Higher latency due to external network calls
    # - Variable-size audio chunks (sometimes 40KB+) → Must split to 24KB in main.py
    # - Realtime API is relatively new and may have stability issues
    elif model_type == BidiModelType.OPENAI or model_type == "openai":
        from strands.experimental.bidi.models import BidiOpenAIRealtimeModel

        if not api_key:
            raise ValueError("API key is required for OpenAI model")

        # Validate OpenAI voice option (defaults to alloy if invalid)
        openai_voice = voice if voice in ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"] else "alloy"
        logger.info(f"Creating OpenAI model with voice={openai_voice}")

        return BidiOpenAIRealtimeModel(
            model_id="gpt-4o-realtime-preview",
            provider_config={
                "audio": {"voice": openai_voice},
            },
            client_config={"api_key": api_key},
        )

    else:
        raise ValueError(f"Unknown model type: {model_type}")
