#!/usr/bin/env bash
set -euo pipefail
umask 022

upload="$1"
[[ "$upload" =~ ^/tmp/jingkao-stage-upload\.[a-zA-Z0-9]+$ ]]
release="$(mktemp -d /tmp/jingkao-stage-release.XXXXXX)"
trap 'rm -rf -- "$release"' EXIT
site=/etc/nginx/sites-enabled/jingkao-staging

if [[ ! -L "$site" ]] && [[ -n "$(ss -H -ltn 'sport = :8088')" ]]; then
  echo "Port 8088 is occupied. Staging was not installed." >&2
  exit 1
fi

tar -xzf "$upload/bundle.tar.gz" -C "$release"
test -f "$release/server/exam-papers.json"
if ! id jingkao-staging >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/jingkao-staging --shell /usr/sbin/nologin jingkao-staging
fi

if [[ ! -f /etc/jingkao-staging.env ]]; then
  (umask 077; python3 -c 'import secrets; print("JINGKAO_ADMIN_USER=staging-qa\nJINGKAO_ADMIN_PASSWORD=" + secrets.token_urlsafe(32))' > /etc/jingkao-staging.env)
fi

install -d -m 0755 /var/www/jingkao-staging /opt/jingkao-staging
install -m 0644 "$release/dist/index.html" "$release/dist/journal.js" /var/www/jingkao-staging/
install -m 0644 "$release/server/app.py" "$release/server/exam-papers.json" /opt/jingkao-staging/
install -m 0644 "$release/server/jingkao-staging.service" /etc/systemd/system/
install -m 0644 "$release/server/jingkao-staging-nginx.conf" /etc/nginx/sites-available/jingkao-staging
ln -sfn /etc/nginx/sites-available/jingkao-staging "$site"

systemctl daemon-reload
systemctl enable jingkao-staging.service
systemctl restart jingkao-staging.service
nginx -t
systemctl reload nginx
curl --silent --show-error --fail --retry 10 --retry-connrefused --retry-delay 1 --max-time 4 http://127.0.0.1:18081/api/health >/dev/null
python3 "$release/ops/smoke-exams.py"
