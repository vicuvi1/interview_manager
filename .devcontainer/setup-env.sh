#!/usr/bin/env bash
# Generate .env.local from Codespaces secrets (NEXT_PUBLIC_SUPABASE_URL +
# NEXT_PUBLIC_SUPABASE_ANON_KEY). No credentials are stored in the repo — they
# come from the environment. Falls back to .env.example if secrets are absent.
set -euo pipefail

if [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && [ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]; then
  {
    echo "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}"
  } > .env.local
  echo "OK: .env.local created from Codespaces secrets."
elif [ ! -f .env.local ]; then
  cp .env.example .env.local 2>/dev/null || true
  echo "WARN: Codespaces secrets not set - copied .env.example to .env.local. Add the two secrets at github.com/settings/codespaces and rebuild."
else
  echo "OK: .env.local already present."
fi
