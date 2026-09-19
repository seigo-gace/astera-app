#!/usr/bin/env python3
"""Remove retired keys from .env without printing values."""
from pathlib import Path

ROOT = Path('/home/admin1/projects/astera-billing/.env')
REMOVE = frozenset({
    'SQUARE_ACCESS_TOKEN',
    'WEBHOOK_GATEWAY_APP_SECRET',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_D1_DATABASE_ID',
})

if not ROOT.is_file():
    raise SystemExit(0)

lines_out: list[str] = []
for line in ROOT.read_text(encoding='utf-8').splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith('#') or '=' not in line:
        lines_out.append(line)
        continue
    key = line.split('=', 1)[0].strip()
    if key in REMOVE:
        continue
    lines_out.append(line)

ROOT.write_text('\n'.join(lines_out) + ('\n' if lines_out else ''), encoding='utf-8')
