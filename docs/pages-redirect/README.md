# `karanawzad.tech/SuliNOC/` entry page

`karanawzad.tech` is served by the separate `kara-nawzad/kara-nawzad.github.io` repository. The
`SuliNOC/index.html` page in this directory is a full-screen iframe wrapper for the Fly-hosted
SuliNOC app. The wrapper deliberately does not redirect, so the browser address stays
`https://karanawzad.tech/SuliNOC/`.

The iframe is cross-site. The React client keeps its session token in `sessionStorage` because some
browsers restrict third-party cookies; the page also provides a direct-open link as a fallback. If a
browser blocks the embedded app or its storage, the reliable same-origin solution is a reverse proxy
for `/SuliNOC/` to the Fly app. GitHub Pages itself cannot proxy requests.

To publish this page, copy `SuliNOC/index.html` from this repository to `SuliNOC/index.html` in
`kara-nawzad/kara-nawzad.github.io` and publish that repository. This repository does not deploy the
custom-domain Pages site automatically.
