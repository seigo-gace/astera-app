# Astera v8 Official Brand Asset Recovery Manifest

## Verdict

The official Astera v8 logo is **not recoverable from the currently accessible source bytes**. The repository must continue to fail the brand-asset gate rather than generate, redraw, crop, or substitute a different logo.

## Notion source of truth

- Parent: `15｜Astera v8 ロゴ・Vector Asset共通正本`
- Original raster names recorded: `56.png` and `58.png`
- Six expected SVG names are recorded in the Notion manifest.
- The old Notion attachments are owned by an earlier integration and cannot be downloaded through the current connection.
- Asset-sheet PNGs in the File Library are previews and completion-report images, not approved source bytes.

## Required repository files

- `public/logo-mark.svg`
- `public/favicon.ico`
- `public/favicon.png`
- `public/apple-touch-icon.png`
- `public/site.webmanifest`
- approved light and dark full-logo SVG files when the source bytes are recovered

## Current byte status

| Asset class | Accessible approved bytes | Repository match | Status |
|---|---:|---:|---|
| Original raster | 0 | 0 | FAIL |
| Individual SVG XML | 0 / 6 | 0 / 6 | FAIL |
| Favicon / app icons | 0 | 0 | FAIL |
| Preview sheets | available | not valid source | EXCLUDED |

## Prohibited recovery methods

- image generation;
- reconstructing geometry from a screenshot or guide sheet;
- substituting a CSS-drawn mark;
- copying a differently shaped historic logo;
- treating a filename, old hash, screenshot, or completion report as the file itself.

## Acceptance gate

The brand gate passes only when all of the following are true:

1. An approved original raster or approved SVG is downloadable through the current integration.
2. Every file can be retrieved individually.
3. SHA-256 is recalculated from the retrieved bytes.
4. The exact bytes are committed to `main`.
5. HTML, manifest, touch icon, favicon, structured data and in-app header all reference the same approved symbol family.
6. Build output contains every path and each returns HTTP 200.
7. Browser tab, bookmark, install icon and app header are visually verified.

Until then, formal logo integration and browser/search logo support are **NO-GO**.
