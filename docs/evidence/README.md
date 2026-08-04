# Astera App Evidence Boundary

This directory is the repository entry point for executed evidence. It must not contain invented success records or copied completion claims from Notion.

## Evidence levels

1. **Design** — current Notion specification.
2. **Source** — files present in `seigo-gace/astera-app` at a named commit.
3. **Authored test** — test source exists but may not have run.
4. **Executed CI** — GitHub Actions run URL, conclusion, logs and artifact digest exist.
5. **Sandbox integration** — Cloudflare, D1, PostgreSQL, Square, OAuth, Storage, Vault and Astera backend were actually exercised.
6. **Device evidence** — browser matrix, emulator, simulator and physical device records exist.
7. **Production** — deployment ID, smoke result and rollback evidence exist.

A lower level never proves a higher level.

## Current status — 2026-08-04

- Design: present.
- Frontend source: present for the canonical 43-route shell.
- Contract and migration source: present as non-deployed candidates.
- Official brand bytes: missing.
- GitHub Actions run evidence: not confirmed.
- Backend sandbox: not confirmed.
- Cloudflare deployment: not confirmed.
- Emulator, simulator and physical device evidence: not confirmed.
- Production: **NO-GO**.

## Required record fields

Every executed record must include:

- repository and commit SHA;
- command or workflow name;
- environment;
- start and end time;
- expected and actual result;
- pass or fail;
- log, response, screenshot or artifact reference;
- digest for generated artifacts;
- unresolved failures and retest result.

Do not place secrets, prompts, file contents, passwords, cookies, authorization headers, API keys, card data or raw provider errors in evidence files.
