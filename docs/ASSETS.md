# Frontend assets

## Where assets live

- `frontend/public/assets/` contains files served at `/assets/` without bundler imports.
- `frontend/public/assets/wave.jpg` is the owner-provided visual reference only. The application does not render this JPEG as the mascot; `frontend/src/components/WaveMascot.tsx` recreates the character as reusable SVG/CSS.
- `frontend/public/assets/hero-source.html` is the small, self-contained welcome page loaded by `HeroFrame`; it contains only the intro composition, buttons, and enter/skip message hook—not a second copy of the React application. Its sole image asset is `hero-city-sunset.jpg`, which already includes the city tower; do not add a separate tower overlay. It references the local Manrope 400/500, Newsreader 600, and IBM Plex Mono 500 WOFF2 files under `frontend/public/assets/fonts/`.
- `HeroFrame` adds the current build ID to the iframe URL to invalidate older browser copies. Only content-fingerprinted Vite assets are cached as immutable; HTML and other stable-name assets must revalidate or not be cached.
- The React app imports its Manrope, Newsreader, and IBM Plex Mono weights from the `@fontsource` npm packages in `frontend/src/main.tsx`; these are bundled by Vite. `frontend/public/assets/suli-noc-logo-dark.png` is used in the React header, and `frontend/public/favicon.svg` is the browser icon. The hero page uses a text wordmark and does not need a separate logo image.
- The former MapLibre map-label font bundle is no longer used; its historical note is archived under `docs/archive/map-label-fonts/` and its OFL notice under `docs/licenses/NOTO-OFL-1.1.txt`.

## Licensing and provenance

The static hero font files are copied from the corresponding `@fontsource` packages in `frontend/package.json`. Their SIL Open Font License 1.1 notices are preserved under [`docs/licenses/`](licenses/): Manrope, Newsreader, and IBM Plex Mono. Keep the relevant notice with any redistributed font files.

The repository does not make a new provenance or licensing claim for the existing hero photograph or logo. When adding or replacing an image, record its source and license (or owner-provided provenance) in the PR and update this page when it changes the asset inventory. Prefer compressed, appropriately sized formats; do not add duplicate variants without a concrete use.

## Maps

The interactive street layer uses Esri raster tiles at runtime; tile imagery is not stored in the repository. If Esri cannot be reached, the React map keeps its local schematic visible and the static fallback keeps its network overlays visible; both expose status and retry. Do not add CARTO configuration, API keys, or downloaded tile caches. Any provider change must preserve the fallback and update the map-status browser test.

## Safe cleanup

Before moving or deleting an asset, search the full repository—including CSS/HTML, React code, build configuration, tests, docs, and scripts—for its exact name and any generated-output path. Retain assets with unresolved external/public use until their owner confirms they can be removed.
