# karanawzad.tech/SuliNOC/ redirect

`karanawzad.tech` is served by `kara-nawzad/kara-nawzad.github.io`. Its `SuliNOC/index.html`
currently embeds `https://autonoc-project.fly.dev/` in an iframe. On phones, embedded
cross-site content can be blocked (cookies, storage), which leaves a black page.

To fix it, replace `SuliNOC/index.html` in that repo with `docs/pages-redirect/SuliNOC/index.html`
from this repo. The page then opens the console at its own address.
