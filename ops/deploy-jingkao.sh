#!/usr/bin/env bash
set -euo pipefail

bundle="/tmp/jingkao-site.tar.gz"
release_dir="$(mktemp -d /tmp/jingkao-release.XXXXXX)"
web_root="/var/www/jingkao-study-journal"

cleanup() {
  rm -rf "$release_dir" "$bundle"
}
trap cleanup EXIT

test -f "$bundle"
test -f /etc/jingkao-api.env
tar -xzf "$bundle" -C "$release_dir"

if ! id jingkao >/dev/null 2>&1; then
  useradd --system --home /var/lib/jingkao --shell /usr/sbin/nologin jingkao
fi

install -d -m 0755 "$web_root"
find "$web_root" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$release_dir/dist"/. "$web_root"/
chown -R www-data:www-data "$web_root"

install -d -o jingkao -g jingkao -m 0750 /var/lib/jingkao
install -d -m 0755 /opt/jingkao-api
install -o jingkao -g jingkao -m 0755 "$release_dir/server/app.py" /opt/jingkao-api/app.py
install -o root -g root -m 0644 "$release_dir/server/jingkao-api.service" /etc/systemd/system/jingkao-api.service
install -o root -g root -m 0644 "$release_dir/server/jingkao-backup.service" /etc/systemd/system/jingkao-backup.service
install -o root -g root -m 0644 "$release_dir/server/jingkao-backup.timer" /etc/systemd/system/jingkao-backup.timer
install -o root -g root -m 0644 "$release_dir/server/jingkao-nginx.conf" /etc/nginx/sites-available/jingkao-study-journal
ln -sfn /etc/nginx/sites-available/jingkao-study-journal /etc/nginx/sites-enabled/jingkao-study-journal

systemctl daemon-reload
systemctl enable jingkao-api.service jingkao-backup.timer
systemctl restart jingkao-api.service
systemctl restart jingkao-backup.timer
healthy=false
for attempt in $(seq 1 15); do
  if curl --fail --silent http://127.0.0.1:8000/api/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done
if [ "$healthy" != "true" ]; then
  systemctl status jingkao-api.service --no-pager || true
  journalctl -u jingkao-api.service -n 40 --no-pager || true
  exit 1
fi
nginx -t
systemctl reload nginx

