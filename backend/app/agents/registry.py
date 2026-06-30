from typing import Optional

from app.agents.base import BaseSiteAgent

_AGENTS: list[type[BaseSiteAgent]] = []


def register(agent_cls: type[BaseSiteAgent]) -> type[BaseSiteAgent]:
    """Decorator to register a site agent."""
    _AGENTS.append(agent_cls)
    return agent_cls


def get_agent_for_url(url: str) -> Optional[type[BaseSiteAgent]]:
    """Find the appropriate agent class for a given URL."""
    for agent_cls in _AGENTS:
        if agent_cls.can_handle(url):
            return agent_cls
    return None
