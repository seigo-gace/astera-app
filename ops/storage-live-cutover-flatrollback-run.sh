#!/usr/bin/env bash
set -Eeuo pipefail

TARGET=/tmp/storage-live-cutover-flatrollback.sh
[ -f "$TARGET" ] || { echo 'OVERALL=BLOCKED'; echo 'REASON=FLAT_ROLLBACK_RUNNER_MISSING'; exit 1; }

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')
old='''  sudo docker export -o "$tarfile" "$container"

  local -a changes
'''
new='''  if ! sudo docker export -o "$tarfile" "$container"; then
    sudo rm -f "$tarfile"
    local merged
    merged="$(sudo docker inspect -f '{{.GraphDriver.Data.MergedDir}}' "$container")"
    [ -n "$merged" ] && [ -d "$merged" ] || return 51
    sudo tar --numeric-owner -C "$merged" -cpf "$tarfile" .
  fi

  local -a changes
'''
if old in s:
    p.write_text(s.replace(old,new,1),encoding='utf-8')
    print('FLAT_SNAPSHOT_EXPORT_FALLBACK_PATCH=PASS')
elif new in s:
    print('FLAT_SNAPSHOT_EXPORT_FALLBACK_PATCH=ALREADY_APPLIED')
else:
    print('FLAT_SNAPSHOT_EXPORT_FALLBACK_PATCH=FAIL|EXPECTED_BLOCK_NOT_FOUND')
    raise SystemExit(2)
PY

bash -n "$TARGET"
echo 'FLAT_ROLLBACK_RUNNER_SYNTAX=PASS'
exec bash "$TARGET"
