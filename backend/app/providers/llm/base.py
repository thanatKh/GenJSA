"""LLM provider interface

Leaves room to swap providers without touching JSA logic — add a new file
under providers/llm/, register it in registry.py, then switch via
`provider:` in config/ai.yaml.
"""

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """The single contract ai_service needs to know about."""

    @abstractmethod
    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        model: str,
        json_mode: bool,
    ) -> str:
        """Send the prompt to the LLM and return the raw text it responds with.

        Don't parse JSON at this layer — that's ai_service + json_repair's job.
        Transport errors must be converted to an AppError from core.errors
        before being raised.
        """

    @abstractmethod
    async def aclose(self) -> None:
        """Close the connection pool on shutdown."""
