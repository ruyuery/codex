# 京考手账自动部署

推送到 main 分支后，GitHub Actions 会把 dist 目录上传到服务器，并执行 ops/deploy-jingkao.sh。

首次配置：

1. 在服务器 WebShell 中安装部署脚本：

   ```bash
   sudo curl -fsSL https://raw.githubusercontent.com/ruyuery/codex/main/ops/deploy-jingkao.sh -o /home/ubuntu/deploy-jingkao.sh
   sudo chown root:root /home/ubuntu/deploy-jingkao.sh
   sudo chmod 755 /home/ubuntu/deploy-jingkao.sh
   echo 'DEPLOY_USER ALL=(root) NOPASSWD: /home/ubuntu/deploy-jingkao.sh' | sudo tee /etc/sudoers.d/jingkao-deploy
   sudo chmod 440 /etc/sudoers.d/jingkao-deploy
   sudo visudo -cf /etc/sudoers.d/jingkao-deploy
   ```

   将 DEPLOY_USER 替换成实际 SSH 用户名后再执行。

2. 创建 GitHub Actions 专用 SSH 密钥：

   ```bash
   mkdir -p ~/.ssh
   chmod 700 ~/.ssh
   ssh-keygen -t ed25519 -f ~/.ssh/github_actions_jingkao -N ''
   cat ~/.ssh/github_actions_jingkao.pub >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   cat ~/.ssh/github_actions_jingkao
   ```

   将最后一条命令输出的完整私钥保存到 GitHub 仓库 Settings > Secrets and variables > Actions，名称为 DEPLOY_SSH_KEY。

3. 添加以下仓库 Secrets：

   - SERVER_HOST = 服务器公网 IP 或域名
   - SERVER_PORT = SSH 端口
   - SERVER_USER = SSH 用户名
   - DEPLOY_SSH_KEY = 上一步生成的完整私钥

部署脚本会更新 /var/www/jingkao-study-journal，并重新加载 Nginx。
