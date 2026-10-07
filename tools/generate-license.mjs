#!/usr/bin/env node
/**
 * 批量生成“费曼反向学校”激活码。
 *
 * 推荐 ECDSA 模式（前端只有公钥，用户无法伪造）：
 *   node tools/generate-license.mjs --mode ecdsa --key tools/keys/private.pem \
 *     --pid trial_1h --product "体验装·1小时" --type time --duration-hours 1 --valid-days 7 --count 10 --out codes.csv
 *
 * 次数套餐：
 *   node tools/generate-license.mjs --pid count_20 --product "次数装·20次" --type count --uses 20 --valid-days 60 --count 10
 *
 * 仅本地演示的 HMAC 模式（密钥会进入浏览器，可被伪造，不要正式售卖）：
 *   node tools/generate-license.mjs --mode hmac --secret "change-me" --pid demo --product "演示" --type time --duration-days 1 --count 1
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, sign, createHmac } from "node:crypto";
import { resolve } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    out[key] = val;
  }
  return out;
}
const args = parseArgs(process.argv);
if (args.help) {
  console.log(`用法示例：
  node tools/generate-license.mjs --mode ecdsa --key tools/keys/private.pem --pid trial_1h --product "体验装·1小时" --type time --duration-minutes 60 --valid-days 7 --count 10 --out codes.csv
  node tools/generate-license.mjs --pid count_20 --product "次数装·20次" --type count --uses 20 --valid-days 60 --count 10
参数：
  --mode ecdsa|hmac       默认 ecdsa
  --key <path>            ECDSA 私钥路径，默认 tools/keys/private.pem
  --secret <str>          HMAC 密钥（仅演示）
  --pid <id>              商品编号
  --product <name>        商品名称
  --type time|count       服务类型
  --duration-seconds N    时长（秒）
  --duration-minutes N    时长（分）
  --duration-hours N      时长（小时）
  --duration-days N       时长（天）
  --uses N                次数套餐可用次数
  --valid-days N          激活码本身的有效期，默认 30 天
  --valid-hours N         激活码本身的有效期小时（与 valid-days 叠加）
  --count N               批量生成数量，默认 1
  --note <str>            备注
  --out <path>            输出 CSV（可选；不填则只打印到屏幕）
`);
  process.exit(0);
}

const mode = String(args.mode || "ecdsa").toLowerCase();
const pid = String(args.pid || "").trim();
const pname = String(args.product || args.pname || pid).trim();
const type = String(args.type || "").trim().toLowerCase();
if (!pid) throw new Error("缺少 --pid");
if (!["time", "count"].includes(type)) throw new Error("--type 必须是 time 或 count");

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
let durationSeconds = null;
if (type === "time") {
  durationSeconds =
    num(args["duration-seconds"], 0) ||
    num(args["duration-minutes"], 0) * 60 ||
    num(args["duration-hours"], 0) * 3600 ||
    num(args["duration-days"], 0) * 86400;
  if (!(durationSeconds > 0)) throw new Error("time 类型必须提供 --duration-seconds/minutes/hours/days");
}
const uses = type === "count" ? num(args.uses, 0) : null;
if (type === "count" && !(uses > 0)) throw new Error("count 类型必须提供 --uses");

const validSeconds = num(args["valid-days"], 30) * 86400 + num(args["valid-hours"], 0) * 3600;
const batch = Math.max(1, Math.floor(num(args.count, 1)));
const now = Math.floor(Date.now() / 1000);
const exp = now + Math.max(0, Math.floor(validSeconds));
const note = args.note ? String(args.note) : "";

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function signPayload(payloadText) {
  if (mode === "hmac") {
    const secret = String(args.secret || "");
    if (!secret) throw new Error("HMAC 模式必须提供 --secret");
    return b64url(createHmac("sha256", secret).update(payloadText, "utf8").digest());
  }
  const keyPath = resolve(String(args.key || "tools/keys/private.pem"));
  const privatePem = readFileSync(keyPath, "utf8");
  const signature = sign("sha256", Buffer.from(payloadText, "utf8"), {
    key: privatePem,
    dsaEncoding: "ieee-p1363"
  });
  return b64url(signature);
}

const rows = [["code", "pid", "pname", "type", "durationSeconds", "uses", "iat", "exp", "jti", "note"]];
for (let i = 0; i < batch; i++) {
  const payload = {
    v: 1,
    jti: randomUUID(),
    pid, pname, type,
    durationSeconds: type === "time" ? durationSeconds : undefined,
    uses: type === "count" ? uses : undefined,
    iat: now,
    exp,
    note: note || undefined
  };
  // 去掉 undefined，保证载荷与浏览器端解析一致
  Object.keys(payload).forEach(k => { if (payload[k] === undefined) delete payload[k]; });
  const payloadText = JSON.stringify(payload);
  const code = b64url(payloadText) + "." + signPayload(payloadText);
  rows.push([code, pid, pname, type, durationSeconds || "", uses || "", now, exp, payload.jti, note]);
  console.log(code);
}

if (args.out) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  writeFileSync(resolve(String(args.out)), "\uFEFF" + csv, "utf8");
  console.error("已写入：" + resolve(String(args.out)));
}
if (mode === "hmac") {
  console.error("⚠️ 当前为 HMAC 演示模式：密钥会进入前端，用户可自行伪造激活码；仅用于本地测试。");
}
