#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="${PATH}:/home/admin1/.nvm/versions/node/v22.23.1/bin"

PROJECT=astera-app-e2e-live
COMPOSE=(docker compose -f docker-compose.e2e-live-process.yml --project-name "$PROJECT")
TOKEN_OVERRIDE_FILE=""

if [[ -z "${ASTERA_PROCESS_ORIGIN:-}" ]]; then
  _v8_port="$(docker exec astera-v8 node -e "process.stdout.write(String(process.env.ASTERA_PORT||''))" 2>/dev/null || true)"
  if [[ -n "${_v8_port}" ]]; then
    export ASTERA_PROCESS_ORIGIN="http://127.0.0.1:${_v8_port}"
  fi
  unset _v8_port
fi

if [[ -z "${ASTERA_PROCESS_ORIGIN:-}" ]]; then
  echo "e2e-live-process failed: set ASTERA_PROCESS_ORIGIN (host Astera Process API origin)" >&2
  exit 1
fi

if [[ -z "${E2E_LIVE_PROCESS_ASTERA_PROCESS_TOKEN:-}" ]]; then
  _v8_key_len="$(docker exec astera-v8 node -e "process.stdout.write(String((process.env.ASTERA_API_KEY||'').length))" 2>/dev/null || echo 0)"
  if [[ "${_v8_key_len}" -gt 0 ]]; then
    E2E_LIVE_PROCESS_ASTERA_PROCESS_TOKEN="$(docker exec astera-v8 node -e "process.stdout.write(process.env.ASTERA_API_KEY||'')")"
    export E2E_LIVE_PROCESS_ASTERA_PROCESS_TOKEN
  fi
  unset _v8_key_len
fi

if [[ -z "${E2E_LIVE_PROCESS_ASTERA_PROCESS_TOKEN:-}" ]]; then
  _signup_origin="${ASTERA_PROCESS_ORIGIN/host.docker.internal/127.0.0.1}"
  ASTERA_PROCESS_ORIGIN="${_signup_origin}" node <<'NODE'
const fs = require('fs');
(async () => {
  const origin = String(process.env.ASTERA_PROCESS_ORIGIN || '').replace(/\/$/, '');
  if (!origin) process.exit(1);
  const path = '/tmp/e2e-live-process-token.secret';
  if (fs.existsSync(path)) {
    const key = fs.readFileSync(path, 'utf8').trim();
    const probe = await fetch(`${origin}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({ question: 'token probe' }),
    });
    if (probe.status !== 401) return;
  }
  const signup = await fetch(`${origin}/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const json = await signup.json();
  const apiKey = String(json.apiKey || '');
  if (!apiKey) process.exit(2);
  fs.writeFileSync(path, apiKey, { mode: 0o600 });
})().catch(() => process.exit(1));
NODE
  E2E_LIVE_PROCESS_ASTERA_PROCESS_TOKEN="$(cat /tmp/e2e-live-process-token.secret)"
  export E2E_LIVE_PROCESS_ASTERA_PROCESS_TOKEN
  unset _signup_origin
fi

if [[ -n "${E2E_LIVE_PROCESS_ASTERA_PROCESS_TOKEN:-}" ]]; then
  TOKEN_OVERRIDE_FILE="$(mktemp)"
  chmod 600 "${TOKEN_OVERRIDE_FILE}"
  {
    echo 'services:'
    echo '  astera-app-api-e2e-live:'
    echo '    environment:'
    printf '      ASTERA_PROCESS_TOKEN: "%s"\n' "${E2E_LIVE_PROCESS_ASTERA_PROCESS_TOKEN}"
  } > "${TOKEN_OVERRIDE_FILE}"
  COMPOSE+=(-f "${TOKEN_OVERRIDE_FILE}")
fi

cleanup() {
  if [[ -n "${TOKEN_OVERRIDE_FILE}" && -f "${TOKEN_OVERRIDE_FILE}" ]]; then
    rm -f "${TOKEN_OVERRIDE_FILE}"
  fi
}
trap cleanup EXIT

fail() {
  echo "e2e-live-process failed: $1" >&2
  "${COMPOSE[@]}" ps >&2 || true
  exit 1
}

_expected_origin="${ASTERA_PROCESS_ORIGIN%/}"

"${COMPOSE[@]}" build astera-app-api-e2e-live astera-app-ui-e2e-live astera-app-pages-e2e-live
"${COMPOSE[@]}" up -d astera-app-api-e2e-live
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T astera-app-api-e2e-live node -e "fetch('http://127.0.0.1:8793/ready').then(async r=>{if(!r.ok)process.exit(1);const j=await r.json();if(!String(j.process_origin||'').includes('7375'))process.exit(2);process.exit(0);}).catch(()=>process.exit(1));" 2>/dev/null; then
    break
  fi
  sleep 2
done
"${COMPOSE[@]}" exec -T astera-app-api-e2e-live node -e "fetch('http://127.0.0.1:8793/ready').then(async r=>{if(!r.ok)process.exit(1);const j=await r.json();if(!String(j.process_origin||'').includes('7375'))process.exit(2);console.log('ready process_origin='+j.process_origin);}).catch(()=>process.exit(1));" || fail "app-api /ready process_origin mismatch"

"${COMPOSE[@]}" up -d astera-app-pages-e2e-live
for _ in $(seq 1 90); do
  if curl -sf -m 2 http://127.0.0.1:8780/ >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -sf -m 2 http://127.0.0.1:8780/ >/dev/null || fail "pages dev not ready on 8780"

"${COMPOSE[@]}" up -d astera-app-ui-e2e-live
for _ in $(seq 1 30); do
  if curl -sf -m 2 http://127.0.0.1:8083/ >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -sf -m 2 http://127.0.0.1:8083/ >/dev/null || fail "ui not ready on 8083"

export E2E_LIVE_PROCESS_OUTPUT_DIR="${E2E_LIVE_PROCESS_OUTPUT_DIR:-/tmp/playwright-e2e-live-process-test-results}"
export E2E_LIVE_PROCESS_REPORT_DIR="${E2E_LIVE_PROCESS_REPORT_DIR:-/tmp/playwright-report-e2e-live-process}"
mkdir -p "${E2E_LIVE_PROCESS_OUTPUT_DIR}" "${E2E_LIVE_PROCESS_REPORT_DIR}"
docker run --rm --network host \
  -v "$PWD:/work" \
  -w /work \
  -e E2E_LIVE_PROCESS_BASE_URL=http://127.0.0.1:8083 \
  -e E2E_LIVE_PROCESS_OUTPUT_DIR="${E2E_LIVE_PROCESS_OUTPUT_DIR}" \
  -e E2E_LIVE_PROCESS_REPORT_DIR="${E2E_LIVE_PROCESS_REPORT_DIR}" \
  mcr.microsoft.com/playwright:v1.62.0-noble \
  /work/node_modules/.bin/playwright test --config /work/playwright.e2e-live-process.config.ts
echo "e2e-live-process playwright finished"
