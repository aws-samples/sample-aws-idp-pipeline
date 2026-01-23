import inspect
import json
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar, cast, get_type_hints

from glide import GlideClusterClient, GlideClusterClientConfiguration, NodeAddress
from pydantic import TypeAdapter

from app.config import get_config
from app.ddb.projects import query_projects
from app.sessions import query_sessions

T = TypeVar("T")


class CacheKey:
    QUERY_PROJECTS = "query_projects"

    @staticmethod
    def session_list(user_id: str, project_id: str) -> str:
        return f"session_list:{user_id}:{project_id}"


_cache_client: GlideClusterClient | None = None


async def _get_cache_client() -> GlideClusterClient | None:
    global _cache_client
    if _cache_client is None:
        config = get_config()
        if not config.elasticache_endpoint:
            return None
        client_config = GlideClusterClientConfiguration(
            [NodeAddress(host=config.elasticache_endpoint, port=6379)],
            use_tls=True,
        )
        _cache_client = await GlideClusterClient.create(client_config)
    return _cache_client


def _cached(
    key_fn: Callable[..., str], expire: int
) -> Callable[[Callable[..., Coroutine[Any, Any, T]]], Callable[..., Coroutine[Any, Any, T]]]:
    def wrapper(fn: Callable[..., Coroutine[Any, Any, T]]) -> Callable[..., Coroutine[Any, Any, T]]:
        return_type = get_type_hints(fn).get("return")
        type_adapter = TypeAdapter(return_type) if return_type else None

        async def _call_fn(*args: Any, **kwargs: Any) -> T:
            if inspect.iscoroutinefunction(fn):
                return await fn(*args, **kwargs)
            return cast(T, fn(*args, **kwargs))

        async def inner(*args: Any, **kwargs: Any) -> T:
            client = await _get_cache_client()
            if client is None:
                return await _call_fn(*args, **kwargs)

            key = key_fn(*args, **kwargs)
            cached_value = await client.get(key)
            if cached_value is not None:
                if type_adapter:
                    return type_adapter.validate_json(cached_value)
                return json.loads(cached_value)

            result = await _call_fn(*args, **kwargs)
            serialized = type_adapter.dump_json(result) if type_adapter else json.dumps(result).encode()
            await client.set(key, serialized.decode())
            await client.expire(key, expire)
            return result

        return inner

    return wrapper


async def invalidate(key: str) -> None:
    client = await _get_cache_client()
    if client is None:
        return
    await client.delete([key])


cached_query_projects = _cached(lambda: CacheKey.QUERY_PROJECTS, expire=3600)(query_projects)


def _session_list_key(user_id: str, project_id: str) -> str:
    return CacheKey.session_list(user_id, project_id)


cached_query_sessions = _cached(_session_list_key, expire=3600)(query_sessions)
