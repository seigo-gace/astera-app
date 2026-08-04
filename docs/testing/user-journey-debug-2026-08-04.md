# Astera App User Journey Debug — 2026-08-04

## Scope

This pass tests the application from the user's point of view rather than treating route existence, component source, or mocked success as completion.

The authored browser matrix covers:

- 22 authenticated routes and exact return-context restoration;
- 6 public routes that must not require an account projection;
- 33 uniquely identified adversarial stories across authentication, Composer execution and canonical Result compatibility;
- Chromium desktop and WebKit touch representatives for adversarial journeys;
- the existing 11-project device matrix for layout, touch, rotation, tablet, foldable, Android, iPhone, iPad and desktop coverage;
- authentication stages, registration, Email verification, Password reset, 2FA, Account state, Checkout, Settings, network failure, API errors, retry, duplicate input, malformed URLs, Composer execution, result completeness, canonical Result objects and accordion behavior.

## Defects found and fixed

### 1. Protected route gate was incomplete

Only `/app` and `/app/new` were gated at the router. Other authenticated routes depended on individual page shells and could produce inconsistent loading or error behavior.

**Fix:** every route marked `access: 'authenticated'` now passes through one Account Session Gate, except Checkout, which intentionally owns an inline Login/Register gate to preserve the selected plan.

### 2. Account projection could be requested twice

The router and responsive shell could both call `/api/account` for one page view.

**Fix:** the verified projection is shared through `AccountSessionProvider`. Protected page navigation now uses one account request and reuses the result for the account name and page shell.

### 3. Email Login ignored required stages

A successful Email Login response could require initial Password setup, 2FA or Email verification, but the UI navigated directly to the requested page.

**Fix:** Email Login and Native Session Exchange now use the same continuation resolver and cannot skip required authentication stages.

### 4. Registration and Email verification lost the user's destination

A user choosing a plan could be sent through registration and Email verification, then lose the original Checkout return path.

**Fix:** `return_to` is preserved through Register → Verify Email → Login → Password setup / 2FA → original page.

### 5. Empty reset Tokens and 2FA Challenges reached the API

The UI allowed a reset or 2FA request with missing required context.

**Fix:** these fail locally with `RESET_TOKEN_REQUIRED` or `TWO_FACTOR_CHALLENGE_REQUIRED`; the typed input remains intact and no request is sent.

### 6. Nested API errors were hidden

Backend errors shaped as `{ error: { code, message } }` became generic `HTTP_...` messages.

**Fix:** nested and flat error payloads are normalized so the user sees the actionable message and code.

### 7. Rapid duplicate submissions could create separate idempotency keys

Two near-simultaneous clicks on an idempotent action could start two browser requests.

**Fix:** concurrent idempotent submissions are deduplicated by method, endpoint and stable request body. One in-flight Promise and one Idempotency Key are used.

### 8. Malformed encoded path parameters could crash route matching

`decodeURIComponent` was used without a fail-closed boundary.

**Fix:** malformed parameters resolve to the Not Found route instead of throwing.

### 9. Plain Enter still depended on a legacy interception layer

The React Composer retained an Enter-to-run handler. The browser interaction layer stopped propagation, but this behavior had no direct user-story evidence.

**Fix:** explicit stories verify that plain Enter and Shift+Enter remain line breaks in normal and Fullscreen Composer, while Ctrl/Cmd+Enter is the explicit keyboard execution action.

### 10. Rapid run activation could race React state

Two clicks could occur before the `isRunning` state had rendered the Stop button.

**Fix:** the capture-phase interaction guard locks launch immediately and the `/process` fetch boundary rejects a second in-flight execution.

### 11. Process requests had no browser-owned request identity

The legacy `/process` request did not attach an Idempotency Key or Request ID.

**Fix:** the process boundary adds one generated identifier to both `Idempotency-Key` and `X-Request-ID`.

### 12. Incomplete Result sections could be shown as completed output

A non-empty one-section payload was accepted by the React normalizer.

**Fix:** the process boundary accepts only JSON with exactly eight non-empty unique sections, including canonical and legacy key aliases. Incomplete output fails closed and the Composer draft remains available.

### 13. The canonical Result contract could not be rendered

The current shared contract defines `sections` as an object keyed by the canonical eight section names, while the legacy React UI only reads arrays or top-level legacy aliases. A correct backend response would therefore be rejected or displayed as empty.

**Fix:** canonical eight-key objects are validated in their fixed order, converted into the legacy display array without discarding titles, content or source IDs, and then returned to the React UI. A dedicated canonical-object story checks all eight rendered sections.

## Authored story evidence

- Authentication and route source: `tests/user-journey-stories.spec.ts`
- Composer source: `tests/composer-user-stories.spec.ts`
- Canonical Result source: `tests/canonical-result-user-stories.spec.ts`
- Static gate: `scripts/user-story-audit.mjs`
- Commands:
  - `npm run story:audit:strict`
  - `npm run e2e:stories`
  - `npm run e2e:devices`
- CI stores the source audit JSON and Playwright report before the final Notion/brand strict gate.

The static audit requires at least:

- 29 unique story tests, currently authored as 33 unique Story IDs;
- 8 Composer-specific stories;
- 20 protected routes, currently 22;
- 5 public routes, currently 6;
- explicit coverage for account state, Checkout trust, required auth stages, open-redirect prevention, duplicate registration, nested errors, network failure, preference safety, retry, malformed paths, Enter behavior, duplicate runs, process identity, fixed eight-section Results, canonical Result objects and draft preservation.

## Evidence status

- Source review: complete for the changed route, auth, API, submission, page-shell, Composer interaction and Result compatibility boundaries.
- Defect fixes: committed to `main`.
- Story test source: committed.
- Static audit source: committed.
- Node 22 syntax check for the complete browser interaction runtime and story audit script: passed.
- GitHub Actions execution: not yet confirmed.
- Playwright pass/fail report: not yet confirmed.
- Cloudflare, backend sandbox, Square, OAuth, Storage, Vault, MCP endpoint and physical-device execution: not confirmed.
- Production: **NO-GO**.

No authored test or source review is reported as an executed pass until a workflow run and artifacts are available.
