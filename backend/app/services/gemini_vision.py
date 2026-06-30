import base64
import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)


async def analyze_screenshot(image_bytes: bytes, prompt: str) -> Optional[str]:
    """
    Send a screenshot to Gemini Vision and get analysis.
    Returns the text response, or None on failure.
    """
    if not settings.gemini_api_key:
        logger.warning("GEMINI_API_KEY not set, skipping vision analysis")
        return None

    b64_image = base64.b64encode(image_bytes).decode("utf-8")

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/png",
                            "data": b64_image,
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 1024,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                GEMINI_URL,
                params={"key": settings.gemini_api_key},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            # Extract text from response
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    text = parts[0].get("text", "")
                    logger.info("Gemini response: %s", text[:200])
                    return text

            logger.warning("No response from Gemini: %s", data)
            return None

    except httpx.HTTPStatusError as e:
        logger.error("Gemini API HTTP error %d: %s", e.response.status_code, e.response.text[:200])
        return None
    except Exception as e:
        logger.error("Gemini API error: %s", e)
        return None
