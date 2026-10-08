# 激活码生成工具

当前 Cloudflare Worker 使用的是 **HMAC-SHA256 v2 激活码**，请使用：

```text
tools/generate-codes.mjs
tools/generate-codes.bat
```

## Windows 一键生成

双击：

```text
tools/generate-codes.bat
```

按提示输入：

- `LICENSE_SECRET`：必须和 Cloudflare Worker Secret 完全一致；
- 商品编号；
- 商品名称；
- 类型 `time` 或 `count`；
- 时长，例如 `1h`、`1d`、`30m`、`3600s`；
- 次数；
- 生成数量；
- 输出 CSV 文件名。

## 命令行生成

```bash
export LICENSE_SECRET='你的密钥'

node tools/generate-codes.mjs \
  --pid trial_1h \
  --product "体验装·1小时" \
  --type time \
  --duration 1h \
  --count 10 \
  --out codes_trial.csv
```

次数套餐：

```bash
node tools/generate-codes.mjs \
  --pid count_20 \
  --product "次数装·20次" \
  --type count \
  --uses 20 \
  --count 10 \
  --out codes_count.csv
```

激活码默认 7 天内必须兑换，兑换后由 Worker 记录 `jti`，全平台只能使用一次。
