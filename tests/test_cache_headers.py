"""Cache policy for the dashboard shell and static assets."""

def test_only_fingerprinted_assets_are_cached_immutably():
    from fastapi.testclient import TestClient
    from autonoc.api import main as M

    with TestClient(M.app) as client:
        entry = client.get("/")
        legacy_hero = client.get("/assets/hero-source.html")
        hero = client.get("/assets/hero-source.html?v=test-build")
        image = client.get("/assets/hero-city-sunset.jpg")
        hashed_bundle = client.get("/assets/index-DSwzS5E8.js")

    assert entry.headers["cache-control"] == "no-store"
    assert legacy_hero.headers["cache-control"] == "no-store"
    assert hero.headers["cache-control"] == "no-store"
    assert image.headers["cache-control"] == "no-cache, max-age=0, must-revalidate"
    assert (
        hashed_bundle.headers["cache-control"]
        == "public, max-age=31536000, immutable"
    )
