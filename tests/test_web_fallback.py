from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = REPOSITORY_ROOT / "autonoc" / "web"


def test_static_fallback_uses_esri_and_exposes_tile_retry() -> None:
    app_js = (WEB_ROOT / "app.js").read_text(encoding="utf-8")
    index_html = (WEB_ROOT / "index.html").read_text(encoding="utf-8")
    styles = (WEB_ROOT / "styles.css").read_text(encoding="utf-8")

    esri_tiles = (
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/"
    )
    assert esri_tiles in app_js
    assert "basemaps.cartocdn.com" not in app_js
    assert 'id="map-status" class="hidden"' in index_html
    assert 'id="map-retry"' in index_html
    assert "$('map-status').classList.toggle('hidden', !retry);" in app_js
    assert "Street map · Esri" not in app_js
    assert "Streets unavailable · network view" in app_js
    assert "loadStreetLayer();" in app_js
    assert "#map-status" in styles
