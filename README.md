# 费曼反向学校｜教会 AI 才算学会

纯静态前端（GitHub Pages）+ Cloudflare Worker 后端 + Cloudflare KV。
AI 不扮演老师，而是扮演一个需要被教会、会主动暴露不懂的学生。

## 文件清单
- `index.html`：设置页
- `chat.html`：对话页
- `admin.html`：运营后台
- `css/styles.css`：全站样式
- `js/config.js`：前端集中配置
- `js/backend.js`：后端 API 封装（流式对话）
- `js/app.js`：页面逻辑、会话持久化、OCR、进度
- `js/admin.js`：后台逻辑
- `cloudflare/worker.js`：Cloudflare Worker 后端
- `cloudflare/wrangler.toml`：Worker 配置
- `tools/generate-codes.mjs`：命令行激活码生成器
- `tools/generate-codes.bat`：Windows 一键生成
- `tools/generate_codes_gui.py`：GUI 生成器源码
- `tools/make_brand_assets.py`：图标与宣传图生成
- `tools/make_pitch_ppt.py`：产品宣传 PPT 生成
- `vendor/`：本地化的 marked / DOMPurify / KaTeX

## 当前架构
```text
GitHub Pages 前端
  → Cloudflare Worker /api/*
      → Cloudflare KV：激活码、会话、余额、用量、日志
      → DeepSeek API：文本对话 + 视觉识图
```

## 本地运行
```bash
python -m http.server 8080
```
浏览器打开 `http://127.0.0.1:8080`。

## 配置
1. 修改 `js/config.js` 中的 `BACKEND.url`。
2. 在 `cloudflare` 目录配置 Worker Secrets：
   - `DEEPSEEK_API_KEY`
   - `DEEPSEEK_VISION_MODEL`（可选，默认 `deepseek-v4-flash-vision-exp`）
   - `DEEPSEEK_VISION_MODEL_FALLBACK`（可选，默认 `deepseek-flash`）
   - `LICENSE_SECRET`
   - `ADMIN_TOKEN`
3. 部署 Worker：
```bash
cd cloudflare
wrangler deploy
```

## 激活码生成
```bash
export LICENSE_SECRET='和 Worker 一致的密钥'
node tools/generate-codes.mjs \
  --pid trial_1h \
  --product "体验装·1小时" \
  --type time \
  --duration 1h \
  --count 10 \
  --out codes.csv
```

## 安全边界
- 前端不保存 DeepSeek API Key；Key 只在 Worker Secret 中。
- 激活码为 HMAC-SHA256 一次性核销，但 KV 最终一致，极高并发下仍需 D1/DO 才能严格原子。
- 激活码可用于跨设备恢复账号，请像账号密码一样保管。
- 聊天记录只保存在本设备浏览器，不跨设备同步。
- 生产环境请设置强 `ADMIN_TOKEN`，并限制 `ALLOWED_ORIGIN`。
