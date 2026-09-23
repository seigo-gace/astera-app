#!/usr/bin/env bash
set -Eeuo pipefail

TARGET=/tmp/storage-live-cutover.sh

[ -f "$TARGET" ] || {
  echo 'OVERALL=BLOCKED'
  echo 'REASON=CUTOVER_RUNNER_MISSING'
  exit 1
}

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')
old = '''OLD_TGS_ID="$(sudo docker inspect -f '{{.Image}}' tgserver-tgs-1)"
OLD_APP_ID="$(sudo docker inspect -f '{{.Image}}' astera-app-api)"
sudo docker tag "$OLD_TGS_ID" "$OLD_TGS_TAG"
sudo docker tag "$OLD_APP_ID" "$OLD_APP_TAG"
ARMED=1'''
new = '''sudo docker commit tgserver-tgs-1 "$OLD_TGS_TAG" >/dev/null
sudo docker commit astera-app-api "$OLD_APP_TAG" >/dev/null
sudo docker image inspect "$OLD_TGS_TAG" >/dev/null
sudo docker image inspect "$OLD_APP_TAG" >/dev/null
ARMED=1'''

if old not in s:
    if new in s:
        print('ROLLBACK_SNAPSHOT_PATCH=ALREADY_APPLIED')
    else:
        print('ROLLBACK_SNAPSHOT_PATCH=FAIL|EXPECTED_BLOCK_NOT_FOUND')
        raise SystemExit(2)
else:
    p.write_text(s.replace(old, new, 1), encoding='utf-8')
    print('ROLLBACK_SNAPSHOT_PATCH=PASS')
PY

bash -n "$TARGET"
echo 'CUTOVER_RUNNER_SYNTAX=PASS'
exec bash "$TARGET"
