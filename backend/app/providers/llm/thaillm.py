"""ThaiLLM provider — OpenAI-compatible chat completions

Endpoint / model / timeout all come from config/ai.yaml.
The API key comes only from an environment variable (via core.config).
"""

import httpx

from ...core.config import AiConfig
from ...core.errors import Errors
from .base import LLMProvider


class ThaiLLMProvider(LLMProvider):
    def __init__(self, config: AiConfig, api_key: str) -> None:
        self._config = config
        self._client = httpx.AsyncClient(
            base_url=config.api.base_url.rstrip("/"),
            timeout=httpx.Timeout(config.api.timeout_seconds),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        model: str,
        json_mode: bool,
    ) -> str:
        payload: dict = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self._config.api.temperature,
            "max_tokens": self._config.api.max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            response = await self._client.post(
                self._config.api.chat_completions_path, json=payload
            )
        except httpx.TimeoutException:
            raise Errors.AI_TIMEOUT from None
        except httpx.HTTPError:
            # DNS, TLS, connection refused — the user doesn't need the details
            raise Errors.AI_UNAVAILABLE from None

        if response.status_code in (401, 403):
            raise Errors.AI_AUTH
        if response.status_code == 429:
            raise Errors.AI_RATE_LIMIT
        if response.status_code == 400 and json_mode:
            # Some providers don't recognize response_format and answer with 400
            # Surface this as bad_response so ai_service retries with json_mode off
            raise Errors.AI_BAD_RESPONSE
        if response.status_code >= 500:
            raise Errors.AI_UNAVAILABLE
        if response.status_code >= 400:
            raise Errors.AI_BAD_RESPONSE

        try:
            data = response.json()
            return data["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError):
            raise Errors.AI_BAD_RESPONSE from None

    async def aclose(self) -> None:
        await self._client.aclose()
