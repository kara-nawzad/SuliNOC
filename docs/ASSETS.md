# Frontend assets

## Where assets live

- `frontend/public/assets/` contains files served at `/assets/` without bundler imports.
- `frontend/public/assets/hero-source.html` is the deliberately small welcome page loaded by `HeroFrame`; it is not a second copy of the application. Its visible composition uses `hero-city-sunset.jpg` and `hero-tower-cutout.webp` plus the locally bundled Manrope, Newsreader, and IBM Plex Mono font weights it references.
- `frontend/public/assets/suli-noc-logo-dark.png` is used by the React header. `frontend/public/favicon.svg` is the browser icon.
- The former MapLibre map-label font bundle is no longer used; its historical note is archived under `docs/archive/map-label-fonts/` and its OFL notice under `docs/licenses/NOTO-OFL-1.1.txt`.
- `frontend/standalone/` contains the optional single-file builder and its fixtures. `SuliNOC-UI.html` is generated on demand and is ignored; do not commit its output.

## Licensing and provenance

The static hero font files are copied from the corresponding `@fontsource` packages in `frontend/package.json`. Their SIL Open Font License 1.1 notices are preserved under [`docs/licenses/`](licenses/): Manrope, Newsreader, and IBM Plex Mono. Keep the relevant notice with any redistributed font files.

The repository does not make a new provenance or licensing claim for the existing hero photographs/cutout or logo. When adding or replacing an image, record its source and license (or owner-provided provenance) in the PR and update this page when it changes the asset inventory. Prefer compressed, appropriately sized formats; do not add duplicate variants without a concrete use.

## Maps

The interactive street layer uses Esri raster tiles at runtime; tile imagery is not stored in the repository. If Esri cannot be reached, the React map keeps its local schematic visible and the static fallback keeps its network overlays visible; both expose status and retry. Do not add CARTO configuration, API keys, or downloaded tile caches. Any provider change must preserve the fallback and update the map-status browser test.

## Safe cleanup

Before moving or deleting an asset, search the full repository—including CSS/HTML, React code, build configuration, tests, docs, and scripts—for its exact name and any generated-output path. Retain assets with unresolved external/public use until their owner confirms they can be removed.
