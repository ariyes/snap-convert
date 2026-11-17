#!/bin/sh
# Snap Convert — make one release live on the server (P25). Shipped inside every release and run
# by deploy/deploy.ts over SSH; also the rollback command (run it with an older release name).
#
#   sh <app>/releases/<release>/deploy/activate.sh <app> <release> [keep] [reload command]
#
#   <app>      DEPLOY_PATH, e.g. /var/www/snap-convert
#   <release>  folder name under <app>/releases/
#   keep       how many releases to keep (default 3); the live one is never deleted
#   reload     shell command that checks and reloads nginx
#              (default: sudo -n nginx -t && sudo -n systemctl reload nginx)
#
# Steps, with no moment where a page's inline scripts are blocked by the CSP:
#   1. security-headers.conf allows the scripts of the live release AND the new one; reload nginx
#   2. switch the `current` symlink to the new release in one rename (atomic)
#   3. security-headers.conf allows the new release's scripts only; reload nginx
#   4. delete old releases beyond <keep>
# If the first reload fails, the old headers file is put back and nothing is switched.
set -eu

APP=${1:?usage: activate.sh <app> <release> [keep] [reload]}
NEW=${2:?usage: activate.sh <app> <release> [keep] [reload]}
KEEP=${3:-3}
RELOAD=${4:-"sudo -n nginx -t && sudo -n systemctl reload nginx"}

say() { printf '%s\n' "$*"; }
die() { printf 'activate.sh: %s\n' "$*" >&2; exit 1; }

case $NEW in
  */* | .* | '') die "bad release name: $NEW" ;;
esac
case $KEEP in
  '' | *[!0-9]*) die "keep must be a number: $KEEP" ;;
esac
[ "$KEEP" -ge 2 ] || die "keep at least 2 releases, so there is always one to roll back to"

cd "$APP" || die "no such folder: $APP"
REL="releases/$NEW"
[ -f "$REL/snap-convert/index.html" ] || die "$APP/$REL/snap-convert/index.html is missing"
[ -f "$REL/deploy/headers.conf.template" ] || die "$REL/deploy/headers.conf.template is missing"
[ -f "$REL/deploy/script-hashes.txt" ] || die "$REL/deploy/script-hashes.txt is missing"

# nginx (often user www-data) must be able to read every file; nobody else may change them
# (archives made by Windows tar mark everything writable by all).
chmod -R a+rX,go-w "$REL"

PREV=''
if [ -L current ]; then
  PREV=$(readlink current)
  PREV=${PREV#releases/}
fi
PREV_HASHES=''
if [ -n "$PREV" ] && [ -f "releases/$PREV/deploy/script-hashes.txt" ]; then
  PREV_HASHES="releases/$PREV/deploy/script-hashes.txt"
fi

# Writes security-headers.conf from the new release's template with the hashes in the given files.
# Same result as renderHeaders() in deploy/csp.ts: distinct hashes, sorted, space-separated.
render() {
  hashes=$(cat "$@" | tr -d '\r' | grep -v '^$' | LC_ALL=C sort -u | tr '\n' ' ' | sed 's/ $//')
  awk -v h="$hashes" '{ gsub(/__SCRIPT_HASHES__/, h); print }' \
    "$REL/deploy/headers.conf.template" > security-headers.conf.next
  mv -f security-headers.conf.next security-headers.conf
}

reload() {
  sh -c "$RELOAD"
}

# 1. Allow both releases' scripts.
if [ -f security-headers.conf ]; then cp -p security-headers.conf security-headers.conf.bak; fi
if [ -n "$PREV_HASHES" ]; then
  render "$PREV_HASHES" "$REL/deploy/script-hashes.txt"
else
  render "$REL/deploy/script-hashes.txt"
fi
if ! reload; then
  if [ -f security-headers.conf.bak ]; then
    mv -f security-headers.conf.bak security-headers.conf
    reload || true
  fi
  die "nginx check/reload failed; nothing was switched (still live: ${PREV:-none})"
fi

# 2. Switch. `mv -T` renames the new link over the old one in one step.
ln -sfn "$REL" current.next
mv -Tf current.next current
say "SNAP_ACTIVE=$NEW"
say "SNAP_PREVIOUS=$PREV"

# 3. Only the live release's scripts. A failure here is safe (step 1's headers still match).
render "$REL/deploy/script-hashes.txt"
reload || say "WARNING: second nginx reload failed; the live headers still allow both releases"
rm -f security-headers.conf.bak

# 4. Keep the newest <keep> releases (names start with a UTC timestamp, so they sort by age),
#    plus the live one and the one before it.
count=$(ls -1 releases | wc -l)
excess=$((count - KEEP))
if [ "$excess" -gt 0 ]; then
  ls -1 releases | LC_ALL=C sort | head -n "$excess" | while IFS= read -r old; do
    if [ "$old" != "$NEW" ] && [ "$old" != "$PREV" ]; then
      rm -rf "releases/$old"
      say "removed old release $old"
    fi
  done
fi
say "Releases on the server:"
ls -1 releases | LC_ALL=C sort | sed 's/^/  /'
