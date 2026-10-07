#!/usr/bin/env node
/**
 * 费曼反向学校 v2 激活码生成器（HMAC-SHA256，配合 Cloudflare Worker）
 *
 * 重要：
 *  - LICENSE_SECRET 必须与 Cloudflare Worker 的 Secret 完全一致；
 *  - 本程序在你自己电脑上离线运行，不要把 LICENSE_SECRET 写进源码或上传 GitHub；
 *  - 激活码默认 7 天内必须兑换，兑换后 Worker 会记录 jti，全平台只能使用一次。
 *
 * 示例：
 *   export LICENSE_SECRET='你的很长很随机密钥'
 *   node tools/generate-codes.mjs --pid trial_1h --product "体验装·1小时" --type time --duration-hours 1 --count 20 --out codes_trial.csv
 *   node tools/generate-codes.mjs --pid count_20 --product "次数装·20次" --type count --uses 20 --count 20 --out codes_count.csv
 */
import { createHmac, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseDuration(input) {
  const s = String(input || "").trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hour|d|day)?$/);
  if (!m) return 0;
  const v = Number(m[1]);
  const u = m[2] || "s";
  if (u.startsWith("d")) return Math.round(v * 86400);
  if (u.startsWith("h")) return Math.round(v * 3600);
  if (u.startsWith("m")) return Math.round(v * 60);
  return Math.round(v);
}
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
  console.log(`用法：
  node tools/generate-codes.mjs --pid trial_1h --product "体验装·1小时" --type time --duration-hours 1 --count 20 --out codes.csv
  node tools/generate-codes.mjs --pid count_20 --product "次数装·20次" --type count --uses 20 --count 20 --out codes.csv

参数：
  --pid <id>              商品编号，必填
  --product <name>        商品名称
  --type time|count       套餐类型
  --duration <str>        例如 1h、1d、30m、3600s
  --duration-seconds N    时长（秒）
  --duration-minutes N    时长（分）
  --duration-hours N      时长（小时）
  --duration-days N       时长（天）
  --uses N                次数套餐次数
  --valid-days N          激活码本身的有效期，默认 7 天
  --count N               批量数量，默认 1
  --out <path>            输出 CSV
  --secret <str>          也可用环境变量 LICENSE_SECRET
`);
  process.exit(0);
}

const secret = String(args.secret || process.env.LICENSE_SECRET || "");
if (!secret) throw new Error("缺少 LICENSE_SECRET。请 export LICENSE_SECRET='...' 或传 --secret。");
const pid = String(args.pid || "").trim();
if (!pid) throw new Error("缺少 --pid");
const pname = String(args.product || args.pname || pid).trim();
const type = String(args.type || "").trim().toLowerCase();
if (!["time", "count"].includes(type)) throw new Error("--type 必须是 time 或 count");

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
let durationSeconds = null;
if (type === "time") {
  durationSeconds =
    (args.duration ? parseDuration(args.duration) : 0) ||
    num(args["duration-seconds"], 0) ||
    num(args["duration-minutes"], 0) * 60 ||
    num(args["duration-hours"], 0) * 3600 ||
    num(args["duration-days"], 0) * 86400;
  if (!(durationSeconds > 0)) throw new Error("time 类型必须提供时长参数。");
}
const uses = type === "count" ? num(args.uses, 0) : null;
if (type === "count" && !(uses > 0)) throw new Error("count 类型必须提供 --uses");

const validDays = num(args["valid-days"], 7);
const batch = Math.max(1, Math.floor(num(args.count, 1)));
const now = Math.floor(Date.now() / 1000);
const exp = now + Math.max(1, Math.floor(validDays * 86400));

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function makeCode(payload) {
  const text = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(text, "utf8").digest();
  return b64url(text) + "." + b64url(sig);
}

const rows = [["code", "pid", "pname", "type", "durationSeconds", "uses", "iat", "exp", "jti"]];
for (let i = 0; i < batch; i++) {
  const payload = {
    v: 2,
    jti: randomUUID(),
    pid,
    pname,
    type,
    iat: now,
    exp
  };
  if (type === "time") payload.durationSeconds = durationSeconds;
  else payload.uses = uses;
  const code = makeCode(payload);
  rows.push([code, pid, pname, type, durationSeconds || "", uses || "", now, exp, payload.jti]);
  console.log(code);
}
if (args.out) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  writeFileSync(resolve(String(args.out)), "\uFEFF" + csv, "utf8");
  console.error("已写入：" + resolve(String(args.out)));
}
