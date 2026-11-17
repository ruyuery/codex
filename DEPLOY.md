# 京考手账自动部署与数据库

## 一次性服务器配置

在 Ubuntu WebShell 中执行，`JINGKAO_ADMIN_USER` 和 `JINGKAO_ADMIN_PASSWORD` 换成应用登录账号密码。

```bash
sudo apt update
sudo apt install -y nginx sqlite3 python3

sudo curl -fsSL https://raw.githubusercontent.com/ruyuery/codex/main/ops/deploy-jingkao.sh -o /home/ubuntu/deploy-jingkao.sh
sudo chown root:root /home/ubuntu/deploy-jingkao.sh
sudo chmod 755 /home/ubuntu/deploy-jingkao.sh
sudo useradd --system --home /var/lib/jingkao --shell /usr/sbin/nologin jingkao 2>/dev/null || true

sudo tee /etc/jingkao-api.env > /dev/null <<'EOF'
JINGKAO_ADMIN_USER=你的应用用户名
JINGKAO_ADMIN_PASSWORD=你的应用密码
JINGKAO_DB_PATH=/var/lib/jingkao/jingkao.sqlite3
JINGKAO_API_HOST=127.0.0.1
JINGKAO_API_PORT=8000
EOF
sudo chown root:jingkao /etc/jingkao-api.env
sudo chmod 640 /etc/jingkao-api.env

echo 'ubuntu ALL=(root) NOPASSWD: /home/ubuntu/deploy-jingkao.sh' | sudo tee /etc/sudoers.d/jingkao-deploy
sudo chmod 440 /etc/sudoers.d/jingkao-deploy
sudo visudo -cf /etc/sudoers.d/jingkao-deploy
```

应用数据库位于 `/var/lib/jingkao/jingkao.sqlite3`。每天凌晨会生成压缩备份到 `/var/backups/jingkao`，保留 30 天。

## GitHub Secrets

在仓库 Settings > Secrets and variables > Actions 中配置：

```text
SERVER_HOST
SERVER_PORT
SERVER_USER
DEPLOY_SSH_KEY
```

推送到 `main` 后，GitHub Actions 会打包前端和 API，上传服务器，重启 API，更新 Nginx，并检查健康接口。

