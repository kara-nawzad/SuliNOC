"""The custom-domain landing page must preserve its URL instead of redirecting."""

from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
LANDING_PAGE = REPOSITORY_ROOT / "docs" / "pages-redirect" / "SuliNOC" / "index.html"


def test_sulinoc_custom_domain_page_embeds_the_app_without_redirecting():
    html = LANDING_PAGE.read_text(encoding="utf-8")

    assert '<iframe' in html
    assert 'src="https://autonoc-project.fly.dev/"' in html
    assert 'title="SuliNOC network operations command center"' in html
    assert 'href="https://autonoc-project.fly.dev/"' in html
    assert "http-equiv=\"refresh\"" not in html
    assert "location.replace" not in html
