"""Cache policy for the dashboard shell and static assets."""


def test_only_fingerprinted_assets_are_cached_immutably():
    from autonoc.api.main import _cache_control_for_path

    assert _cache_control_for_path("/") == "no-store"
    assert _cache_control_for_path("/api/data") == "no-store"
    assert _cache_control_for_path("/assets/hero-source.html") == "no-store"
    assert (
        _cache_control_for_path("/assets/hero-city-sunset.png")
        == "no-cache, max-age=0, must-revalidate"
    )
    assert (
        _cache_control_for_path("/assets/index-DSwzS5E8.js")
        == "public, max-age=31536000, immutable"
    )
    assert (
        _cache_control_for_path("/assets/map-_Rz60ELm.js")
        == "public, max-age=31536000, immutable"
    )
    assert (
        _cache_control_for_path("/static/app.js")
        == "no-cache, max-age=0, must-revalidate"
    )
