# Cloudflare Worker 后端部署与测试

## 一、准备
1. 安装 Node.js 18+。
2. 安装 Wrangler：
```bash
npm install -g wrangler
```
3. 登录 Cloudflare：
```bash
wrangler login
```

## 二、创建 KV 并填写配置
在 `cloudflare` 目录执行：
```bash
cd cloudflare
wrangler kv namespace create LICENSE_KV
```
命令会输出类似：
```text
[[kv_namespaces]]
binding = "LICENSE_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```
把 `id` 填进 `cloudflare/wrangler.toml`。
同时把 `ALLOWED_ORIGIN` 改成你的 GitHub Pages 地址，例如：
```toml
ALLOWED_ORIGIN = "https://你的用户名.github.io"
```

## 三、设置 Secrets
```bash
wrangler secret put DEEPSEEK_API_KEY
# 粘贴你的 DeepSeek API Key
wrangler secret put LICENSE_SECRET
# 粘贴一个你自己生成的长随机字符串，例如 64 位以上
```
注意：`LICENSE_SECRET` 必须和生成激活码时使用的完全一致，但不要写进任何前端代码或提交到 GitHub。

## 四、部署
```bash
wrangler deploy
```
成功后你会得到类似：
```text
https://feynman-reverse-school-api.你的子域.workers.dev
```

## 五、生成测试激活码
回到项目根目录：
```bash
cd ..
export LICENSE_SECRET='和 Worker 里完全一致的那个密钥'

node tools/generate-codes.mjs \
  --pid trial_1h \
  --product "体验装·1小时" \
  --type time \
  --duration-hours 1 \
  --count 2 \
  --out codes_test.csv
```
终端会打印两个激活码。默认 7 天内必须兑换。

## 六、测试接口

假设 Worker 地址是：
```text
https://feynman-reverse-school-api.abc.workers.dev
```

### 1. 健康检查
```bash
curl https://feynman-reverse-school-api.abc.workers.dev/api/health
```

### 2. 兑换激活码
```bash
curl -X POST https://feynman-reverse-school-api.abc.workers.dev/api/redeem \
  -H "Content-Type: application/json" \
  -d '{"code":"把激活码粘贴到这里","clientId":"test-device-001"}'
```
返回会包含 `token` 和 `status`。同一个码再次兑换应返回：
```json
{"ok":false,"error":"CODE_ALREADY_USED",...}
```

### 3. 查询状态
```bash
curl -X POST https://feynman-reverse-school-api.abc.workers.dev/api/status \
  -H "Content-Type: application/json" \
  -d '{"token":"上一步返回的 token"}'
```

### 4. 测试流式对话
```bash
curl -N -X POST https://feynman-reverse-school-api.abc.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"token":"上一步返回的 token","knowledgePoint":"什么是熵","learningGoal":"讲给高中生听","start":true,"messages":[]}'
```
如果一切正常，会返回 SSE 流式内容。

### 5. 结束本次对话
```bash
curl -X POST https://feynman-reverse-school-api.abc.workers.dev/api/end \
  -H "Content-Type: application/json" \
  -d '{"token":"上一步返回的 token"}'
```

## 七、当前限制说明
- KV 的读写是最终一致的。极高并发下，同一个码同时兑换可能存在极小概率竞争。
- 如果要 100% 原子核销，建议升级为：
  - Cloudflare D1：`used_codes.jti` 建唯一索引；或
  - Durable Object：单实例串行处理兑换。
- 当前方案已经可以防止普通用户重复兑换、改前端、看源码伪造。
