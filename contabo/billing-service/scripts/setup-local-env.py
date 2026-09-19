#!/usr/bin/env python3
"""Create or update .env without printing secret values."""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path('/home/admin1/projects/astera-billing')
EXAMPLE = ROOT / '.env.example'
TARGET = ROOT / '.env'
VAULT_TOKEN_SOURCE = Path('/home/admin1/projects/astera-app/contabo/app-api/.env')

REMOVE_KEYS = frozenset({
    'SQUARE_ACCESS_TOKEN',
    'WEBHOOK_GATEWAY_APP_SECRET',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
})

KEYS = [
    'SQUARE_LOCATION_ID',
    'SQUARE_ENVIRONMENT',
    'SQUARE_WEBHOOK_NOTIFICATION_URL',
    'BILLING_APP_SECRET',
    'ASTERA_PROJECTION_API_URL',
    'LIBRAL_VAULT_INTERNAL_ORIGIN',
    'LIBRAL_VAULT_INTERNAL_TOKEN',
    'VAULT_SQUARE_ACCESS_SECRET_ID',
    'VAULT_SQUARE_WEBHOOK_HMAC_SECRET_ID',
    'APP_PUBLIC_ORIGIN',
    'PORT',
]

SEARCH_ROOTS = [
    Path('/home/admin1/projects/astera-app'),
    Path('/home/admin1/projects/astera-billing'),
    Path('/home/admin1'),
]


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    try:
        text = path.read_text(encoding='utf-8', errors='ignore')
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        out[key.strip()] = value.strip()
    return out


def discover_key(key: str) -> str | None:
    for root in SEARCH_ROOTS:
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.git', 'dist', 'build', '.next', 'pages-dist', '.wrangler')]
            for fn in filenames:
                if not (fn.startswith('.env') or fn in ('wrangler.toml', '.dev.vars')):
                    continue
                values = parse_env_file(Path(dirpath) / fn)
                if values.get(key):
                    return values[key]
    return None


def main() -> None:
    base = parse_env_file(EXAMPLE)
    existing = parse_env_file(TARGET)
    for key, value in existing.items():
        if key not in REMOVE_KEYS and value:
            base[key] = value

    vault_source = parse_env_file(VAULT_TOKEN_SOURCE)
    if vault_source.get('LIBRAL_VAULT_INTERNAL_TOKEN'):
        base['LIBRAL_VAULT_INTERNAL_TOKEN'] = vault_source['LIBRAL_VAULT_INTERNAL_TOKEN']
    elif not base.get('LIBRAL_VAULT_INTERNAL_TOKEN'):
        found = discover_key('LIBRAL_VAULT_INTERNAL_TOKEN')
        if found:
            base['LIBRAL_VAULT_INTERNAL_TOKEN'] = found

    for key in KEYS:
        if key in base and base[key]:
            continue
        found = discover_key(key)
        if found:
            base[key] = found
        elif key not in base:
            base[key] = ''

    for remove_key in REMOVE_KEYS:
        base.pop(remove_key, None)

    ordered = [f"{key}={base.get(key, '')}" for key in KEYS]
    extra_keys = sorted(k for k in base if k not in KEYS and k not in REMOVE_KEYS)
    ordered.extend(f"{k}={base[k]}" for k in extra_keys)
    TARGET.write_text('\n'.join(ordered) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
