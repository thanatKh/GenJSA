"""Select the LLM provider per config/ai.yaml

To add a new provider: write a class that subclasses LLMProvider, add it to
_PROVIDERS, then switch `provider:` in config/ai.yaml — no need to touch JSA logic.
"""

from ...core.config import Settings
from .base import LLMProvider
from .thaillm import ThaiLLMProvider

_PROVIDERS: dict[str, type[LLMProvider]] = {
    "thaillm": ThaiLLMProvider,
    # "ollama": OllamaProvider,     # on-prem — can be added later
    # "openai": OpenAIProvider,
}


def build_provider(settings: Settings) -> LLMProvider:
    name = settings.ai.provider.lower()
    provider_cls = _PROVIDERS.get(name)
    if provider_cls is None:
        known = ", ".join(sorted(_PROVIDERS))
        raise RuntimeError(
            f"Unknown provider '{name}' in config/ai.yaml (supported: {known})"
        )
    return provider_cls(settings.ai, settings.thaillm_api_key)
