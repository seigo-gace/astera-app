#!/usr/bin/env bash
set -Eeuo pipefail

TARGET=/tmp/storage-live-cutover-step6.sh
[ -f "$TARGET" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=STEP6_RUNNER_MISSING'; exit 1; }

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
old='''code="$(curl -sS --max-time 5 -o /tmp/tgs-auth.json -w '%{http_code}' -X PUT http://127.0.0.1:3000/internal/v1/user-storage/cutover-auth-probe || true)"'''
new='''code="$(curl -sS --max-time 5 -o /tmp/tgs-auth.json -w '%{http_code}' http://127.0.0.1:3000/internal/storage/users/cutover-auth-probe/topic || true)"'''
if old in s:
    s=s.replace(old,new,1)
elif new not in s:
    print('TGS_AUTH_PROBE_PATCH=FAIL|EXPECTED_LINE_NOT_FOUND')
    raise SystemExit(2)
p.write_text(s,encoding='utf-8')
print('TGS_AUTH_PROBE_PATCH=PASS')
PY

bash -n "$TARGET"
echo 'STEP6_RUNNER_SYNTAX=PASS'
exec bash "$TARGET"
