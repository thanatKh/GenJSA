"""Cache headers on the served frontend (see the cache policy in app/main.py).

A stale index.html is what broke PDF creation after a deploy: it pointed at
/assets/* files the new deploy had deleted. These pin the policy down.

Only meaningful when a frontend build exists — app/main.py mounts the static
routes only if frontend/dist does — so the whole module skips otherwise.
"""

import httpx
import pytest

from app.main import FRONTEND_DIST, app

pytestmark = pytest.mark.skipif(
    not (FRONTEND_DIST / "index.html").exists(),
    reason="no frontend build (run `npm run build` in frontend/)",
)


async def get(path: str) -> httpx.Response:
    # httpx's ASGI transport, not fastapi.testclient (deprecated in Starlette)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


async def test_index_html_is_always_revalidated():
    for path in ["/", "/index.html", "/some/client/route"]:
        response = await get(path)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-cache", path


async def test_hashed_assets_are_cached_long_term():
    asset = next((FRONTEND_DIST / "assets").glob("*.js"))
    response = await get(f"/assets/{asset.name}")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


async def test_missing_asset_is_a_404_not_index_html():
    """An old page asking for a deleted chunk must get a clear failure (which
    main.tsx turns into one reload), never index.html served as JavaScript."""
    response = await get("/assets/engine-DELETED.js")
    assert response.status_code == 404
    assert "cache-control" not in response.headers or "immutable" not in response.headers["cache-control"]


async def test_public_files_are_cached_for_a_day():
    response = await get("/favicon.svg")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=86400"
