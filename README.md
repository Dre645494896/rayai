# RayAI · AI 创作平台

网页已发布在 [GitHub Pages](https://dre645494896.github.io/rayai/)，图片生成服务运行在 [Render](https://rayai-cb2s.onrender.com/api/health)。GitHub Pages 只承载静态页面，不保存管理员 API Key，也不能独自处理生图请求。

## 运行与发布

- 本地开发：安装 Node.js 20 以上版本，运行 `npm ci`、`npm start`，访问 `http://127.0.0.1:4173`。
- GitHub Pages：推送 `main` 分支后，`.github/workflows/pages.yml` 构建并发布 `dist/pages`。仓库的 Pages Source 需选择 **GitHub Actions**。
- Render 后端：按 [部署说明](DEPLOY_RENDER.md)创建服务，取得 `https://…onrender.com` 地址后，将它填入 GitHub 仓库变量 `RAYAI_API_BASE_URL`，再重新运行 Pages 工作流。

网页中的邀请码由后端验证。访问凭证保存在当前浏览器 30 天；对话、参考图和生成图片也只保存在各自浏览器。旧站的数据可用用户菜单中的“导出备份”保存，再在新站“导入备份”。备份不包含 API Key 或访问凭证，自定义模型密钥需要在新站重新填写。

仅内置 `gpt-image-2.6-sunburst`。管理员密钥须放在 Render 的 `MUZE_API_KEY` 环境变量中，不要写入仓库、网页配置、备份或提交记录。自定义模型仍由访客在其浏览器中保存配置。
