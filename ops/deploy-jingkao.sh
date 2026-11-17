#!/usr/bin/env bash
set -euo pipefail

bundle="/tmp/jingkao-site.tar.gz"
web_root="/var/www/jingkao-study-journal"
release_dir="$(mktemp -d /tmp/jingkao-release.XXXXXX)"

cleanup() {
  rm -rf "$release_dir" "$bundle"
}
trap cleanup EXIT

test -f "$bundle"
tar -xzf "$bundle" -C "$release_dir"

install -d -m 0755 "$web_root"
find "$web_root" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$release_dir"/. "$web_root"/
chown -R www-data:www-data "$web_root"

nginx -t
systemctl reload nginx
