# RayAI Render 后端

1. 登录 Render，选择 **New → Blueprint**，连接 `Dre645494896/rayai`，使用仓库中的 `render.yaml` 创建免费 Web Service。
2. 在 Render 环境变量中填写 `MUZE_API_KEY`（2.6）、`MUZE_API_KEY_IMAGE_2_5`（2.5）、`MUZE_API_KEY_IMAGE_2`（2）和 `INVITE_CODES`。两个新增模型须分别使用对应的专用密钥。邀请码使用 JSON 映射，格式为 `{"访客标识":"邀请码的 SHA-256 十六进制摘要"}`。每位访客使用独立标识和邀请码。不要把明文邀请码、摘要映射或 API Key 提交到 GitHub。
3. `INVITE_SESSION_SECRET` 由 Render 自动生成。`FRONTEND_ORIGIN` 已设置为 `https://dre645494896.github.io`，仅允许该网页来源跨域调用。
4. 部署完成后，打开 `https://<服务名>.onrender.com/api/health` 检查服务可访问。然后在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 中新增 `RAYAI_API_BASE_URL`，值填 Render 服务的 HTTPS 源地址（不要加路径或末尾 `/`）。重新运行 **Publish RayAI Pages** 工作流。
5. 从 GitHub Pages 打开 RayAI，用邀请码验证文生图、参考图生成及刷新恢复。请朋友分别测试 Pages 地址和 Render 健康检查地址；旧站在新地址验证成功前继续保留。

免费服务闲置后会休眠，首次请求需要等待唤醒。移除 `INVITE_CODES` 中的访客标识后，该访客此前取得的访问凭证也会失效。
