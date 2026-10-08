# 费曼反向学校｜教会 AI 才算学会

纯静态网页。AI 不扮演老师，而扮演一个需要被教会、会主动暴露不懂的学生：用户讲知识点，AI 追问、犯典型错误、要求举例；讲不清时 AI 明确说没懂；达到标准后输出 `[[PASS]]`，用户通关。

## 文件清单
- `index.html`：页面结构
- `css/styles.css`：样式
- `js/config.js`：集中配置（API Key、模型、授权公钥等）
- `js/auth.js`：激活码验签、授权状态、计时/加时
- `js/api.js`：OpenAI 兼容接口调用 + AI 学生系统提示词
- `js/app.js`：页面逻辑、会话持久化、OCR、进度
- `tools/keygen.mjs`：生成 ECDSA P-256 密钥对
- `tools/generate-license.mjs`：批量生成激活码
- `.nojekyll`：GitHub Pages 必需
- `.gitignore`：防止私钥/激活码 CSV 被提交

## 本地运行
```bash
cd feynman-reverse-school
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```
不要直接双击 `index.html` 后依赖部分浏览器安全策略；建议用本地 HTTP 服务。

## 首次配置
1. 修改 `js/config.js` 中的 `API.baseUrl`、`API.model`。当前预填的是 DeepSeek OpenAI 兼容接口，请按你的实际服务商确认。
2. 生成授权密钥（推荐 ECDSA，前端只放公钥）：
```bash
node tools/keygen.mjs
```
把输出的 `publicJwk` 全部复制到 `js/config.js` 的 `AUTH.publicKeyJwk`。私钥 `tools/keys/private.pem` 只留在本机，永远不要提交 GitHub。
3. 生成激活码：
```bash
node tools/generate-license.mjs --mode ecdsa --key tools/keys/private.pem \
  --pid trial_1h --product "体验装·1小时" --type time --duration-hours 1 --valid-days 7 --count 10 --out codes.csv
```
4. 部署到 GitHub Pages 后，在页面输入激活码即可验证。

## 安全边界（重要）
- 纯前端无法真正保密任何密钥。页面里的 API Key、HMAC 密钥、授权逻辑都可被用户查看。
- ECDSA 方案：前端只放公钥，用户可以校验激活码，但**无法从公钥反推私钥来伪造码**；这比 HMAC 更适合正式售卖。但用户仍可修改 localStorage、篡改本地时间、绕过前端限制。
- HMAC 方案：前端也需要密钥，用户可以自己生成合法激活码。只适合本地演示。正式售卖必须用 ECDSA 或服务端校验。
- 真正可靠的做法：加一个你控制的轻量后端/云函数/Cloudflare Worker，做 API 转发和激活码校验。前端仍然可以保留本地缓存，但最终判定以服务端为准。

## 授权规则
激活码载荷包含：`v, jti, pid, pname, type(time/count), durationSeconds/uses, iat, exp, note`。
- `type=time`：从首次激活或“当前有效期”起算；有效期内再次输入同类码，到期时间叠加，实现加时。
- `type=count`：每发送一次用户讲解扣 1 次（可在 `config.js` 的 `countUnit` 调整）。
- 时间到期但当前对话未结束时，允许完成本次对话；开始新对话需要加时/激活。
- 本地时钟回拨超过 2 分钟会被检测并锁定新对话。

## GitHub Pages 部署
1. 新建 GitHub 仓库，例如 `feynman-reverse-school`。
2. 把本目录所有文件上传（**不要上传 `tools/keys/private.pem` 和 `codes.csv`**）。
3. 仓库 Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`，Branch 选 `main` / `(root)`，保存。
4. 等待 1-2 分钟，访问 `https://你的用户名.github.io/feynman-reverse-school/`。

## 关于当前演示密钥
项目里已经放了一对“演示密钥”用于你立刻测试：
- `js/config.js` 里的 `publicKeyJwk` 是演示公钥。
- `tools/keys/private.pem` 是演示私钥，已被 `.gitignore` 忽略，**不要提交到 GitHub**。
- 正式售卖前，请运行 `node tools/keygen.mjs` 重新生成一对属于你自己的密钥，并替换 `publicKeyJwk`。
