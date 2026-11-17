#!/bin/sh
# Snap Convert deploy for macOS, Linux and Git Bash (P25). Same steps as deploy.ps1; both run
# deploy/deploy.ts. Settings: deploy/.env (copy deploy/.env.example; never put passwords in it).
#
#   sh deploy/deploy.sh               build, check, upload, switch, print the rollback command
#   sh deploy/deploy.sh --dry-run     build and pack, print the scp/ssh commands, don't connect
#   sh deploy/deploy.sh --skip-build  reuse build/client
#   sh deploy/deploy.sh --local DIR   deploy into a local folder instead of the server
set -eu
cd "$(dirname "$0")/.."

# Git Bash windows opened before Node was installed don't have it on PATH yet.
PATH="$PATH:/c/Program Files/nodejs:$HOME/AppData/Roaming/npm"

need="node pnpm tar"
case " $* " in
  *" --local "* | *" --dry-run "*) ;;
  *) need="$need ssh scp" ;;
esac
for tool in $need; do
  command -v "$tool" >/dev/null 2>&1 || { echo "deploy: '$tool' not found on PATH" >&2; exit 1; }
done

exec node deploy/deploy.ts "$@"
