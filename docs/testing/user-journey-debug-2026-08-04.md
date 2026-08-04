# Astera App User Journey Debug — 2026-08-04

## Scope

This pass tests the application from the user's point of view rather than treating route existence, component source, or mocked success as completion.

The authored browser matrix now contains:

- 48 unique adversarial Story IDs in 7 dedicated Story files;
- 22 authenticated routes with exact return-context restoration;
- 6 public routes that must not request the protected account projection;
- 8 Composer-specific stories;
- Chromium desktop and WebKit touch representatives for adversarial journeys;
- the existing 11-project device matrix for desktop, Android, iPhone, iPad, tablet, foldable, touch, rotation and legacy WebView coverage.

## Defects found and fixed

1. **Incomplete protected-route gate** — every `access: authenticated` route now uses one Account Session Gate; Checkout keeps its inline Login/Register gate so the selected plan remains visible.
2. **Duplicate account projection** — Router and responsive shell now share one verified account projection through `AccountSessionProvider`.
3. **Required authentication stages were skipped** — Email Login and Native Session Exchange now honor pending Email verification, initial Password setup and 2FA.
4. **Return context was lost** — Register → Verify Email → Login → Password setup / 2FA retains the original Checkout, Credit, Developer or App destination.
5. **Authentication return loops** — `return_to` pointing to Login, Register, Verify, Reset, Password setup or 2FA is rejected.
6. **Missing reset Tokens and 2FA Challenges reached the API** — local fail-closed errors preserve the user's typed input.
7. **Nested API errors were hidden** — flat and nested error shapes expose the actionable message and code.
8. **Concurrent idempotent form submissions duplicated requests** — one in-flight Promise and one request identity are reused.
9. **Malformed encoded route parameters crashed matching** — malformed parameters now resolve to Not Found.
10. **Plain Enter could submit the Composer** — plain Enter and Shift+Enter are line breaks; Ctrl/Cmd+Enter is explicit execution in normal and Fullscreen Composer.
11. **Rapid execution raced React state** — capture-phase launch locking and `/process` in-flight rejection prevent duplicate execution.
12. **Process requests lacked identity** — `Idempotency-Key` and `X-Request-ID` use the same generated value.
13. **Incomplete Results appeared complete** — only exactly eight non-empty unique sections are accepted.
14. **Canonical eight-key Result objects were incompatible with the legacy UI** — canonical objects are validated and normalized into the fixed display order without dropping titles, content or source IDs.
15. **Local file attachments sent only metadata** — unresolved files without an upload/object/storage reference fail closed before backend execution; the app does not pretend that file content was analyzed.
16. **Input length was not authoritative** — Composer and request boundary enforce 200,000 Unicode characters.
17. **Non-JSON proxy/error pages could be shown as Results** — successful responses must be JSON and pass the eight-section gate.
18. **Process failures showed only HTTP numbers** — the user sees the specific stop reason and error code.
19. **Checkout could duplicate or hang** — one intent request at a time, 15-second timeout, paired request identity and abort on unmount.
20. **Checkout URL validation and navigation disagreed** — safe same-origin returns are allowed; external destinations remain HTTPS-only and Square-host allowlisted at Checkout surfaces.
21. **Purpose selection contradicted the single-selection specification** — selecting another Purpose deselects the previous one.
22. **Project Source controls silently did nothing** — unavailable controls are disabled with a visible implementation-state notice.
23. **Legacy Settings implied persistent save** — the dialog now states that its changes are session-only and links to the actual Settings page.
24. **Pricing timeout became endless loading** — timeout produces `CATALOG_TIMEOUT` and a Retry action.
25. **History search requested on every keystroke** — an abortable 250 ms debounce sends only the final query.
26. **Passkey, 2FA and Backup Code controls produced fake success** — incomplete security flows are disabled until the full Browser Credential / QR / Secret path exists.
27. **Credit product ID was free text** — only active products from the account catalog can be submitted.
28. **Credit Checkout accepted untrusted destinations** — the same Checkout destination trust boundary is applied.
29. **Unavailable Developer targets could issue keys** — unavailable/preparing targets remain visible but cannot be selected.
30. **Issued Developer secrets could be discarded** — a key issuance succeeds only when the one-time secret is received and displayed; missing secret fails closed.

## Story files

- `tests/user-journey-stories.spec.ts`
- `tests/composer-user-stories.spec.ts`
- `tests/canonical-result-user-stories.spec.ts`
- `tests/process-boundary-user-stories.spec.ts`
- `tests/checkout-resilience-user-stories.spec.ts`
- `tests/ui-honesty-user-stories.spec.ts`
- `tests/account-commercial-user-stories.spec.ts`

Static gate: `scripts/user-story-audit.mjs`

Commands:

- `npm run story:audit:strict`
- `npm run e2e:stories`
- `npm run e2e:devices`

CI validates all Browser helper scripts, audits the Story sources, typechecks/builds the app, runs the full Playwright device and Story matrix, then uploads reports before the final Notion/brand strict gate.

## Evidence status

- Source review and fixes: committed to `main`.
- Authored Story source: committed.
- Story and Notion static gates: committed.
- Final Browser helper scripts and audit scripts: Node 22 syntax check passed.
- Final changed TypeScript/TSX boundaries: TypeScript syntax/transpile checks passed; the changed Account/Commercial boundary also passed a strict temporary dependency-stub compilation.
- Complex Account/Commercial Story source: TypeScript syntax check passed.
- Full repository dependency install, canonical `tsc --noEmit`, Vite build and Playwright execution: not confirmed in the connected GitHub environment.
- GitHub Actions execution: not yet confirmed through an accessible repository-wide Run listing.
- Playwright pass/fail artifacts: not yet confirmed.
- Cloudflare, backend sandbox, Square, OAuth, Storage, Vault, MCP endpoint, emulator/simulator and physical-device execution: not confirmed.
- Official approved logo bytes: missing; strict source gate remains failing.
- Production: **NO-GO**.

Authored tests and source review are not reported as executed passes until workflow/job evidence is available.
