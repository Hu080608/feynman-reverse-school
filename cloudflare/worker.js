/**
 * 费曼反向学校 Cloudflare Worker 后端。
 * 作用：
 *  1. 一次性核销激活码（KV 记录 jti，已使用不可再次兑换）
 *  2. 维护套餐队列（时间套餐按顺序排队，次数套餐按次扣减）
 *  3. 隐藏 DeepSeek API Key，并转发流式对话
 *
 * 环境变量 / Secrets：
 *  - LICENSE_KV           KV namespace binding
 *  - DEEPSEEK_API_KEY     DeepSeek API Key
 *  - LICENSE_SECRET       激活码 HMAC 密钥（生成脚本与 Worker 必须一致）
 *  - ALLOWED_ORIGIN       允许的前端 Origin，例如 https://yourname.github.io
 *  - DEEPSEEK_BASE_URL    默认 https://api.deepseek.com
 *  - DEEPSEEK_MODEL       默认 deepseek-chat
 */

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const enc = new TextEncoder();

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-admin-token",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({}, JSON_HEADERS, corsHeaders(env))
  });
}

function b64urlToBytes(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.byteLength; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

async function verifyLicenseCode(code, env, ignoreExpiry) {
  const raw = String(code || "").trim().replace(/\s+/g, "");
  const parts = raw.split(".");
  if (parts.length !== 2) throw new Error("激活码格式不正确。");
  const payloadText = new TextDecoder().decode(b64urlToBytes(parts[0]));
  let payload;
  try { payload = JSON.parse(payloadText); }
  catch (e) { throw new Error("激活码载荷无法解析。"); }
  const expected = await hmacSha256(env.LICENSE_SECRET || "", payloadText);
  const actual = b64urlToBytes(parts[1]);
  if (!timingSafeEqual(expected, actual)) throw new Error("激活码签名无效。");
  if (payload.v !== 2) throw new Error("激活码版本不支持。");
  if (!["time", "count"].includes(payload.type)) throw new Error("激活码套餐类型无效。");
  if (payload.type === "time" && !(Number(payload.durationSeconds) > 0)) throw new Error("激活码时长无效。");
  if (payload.type === "count" && !(Number(payload.uses) > 0)) throw new Error("激活码次数无效。");
  const now = Date.now();
  if (!ignoreExpiry && payload.exp && now > Number(payload.exp) * 1000) throw new Error("激活码已超过激活有效期。");
  if (payload.nbf && now < Number(payload.nbf) * 1000) throw new Error("激活码尚未生效。");
  return payload;
}

async function kvGetJson(env, key) {
  const value = await env.LICENSE_KV.get(key, "json");
  return value || null;
}
async function kvPutJson(env, key, value, options) {
  await env.LICENSE_KV.put(key, JSON.stringify(value), options || {});
}

function newSession(clientId) {
  const now = Date.now();
  return {
    token: crypto.randomUUID(),
    clientId: clientId || "",
    createdAt: now,
    updatedAt: now,
    inConversation: false,
    closing: false,
    timeRemainingMs: 0,
    remainingUses: 0,
    timeActiveAt: null,
    priority: "time",
    endedConversations: [],
    recoveryCount: 0
  };
}

function migrateSession(session, now) {
  if (!session || !Array.isArray(session.grants)) return false;
  let time = Number(session.timeRemainingMs || 0);
  let uses = Number(session.remainingUses || 0);
  for (const g of session.grants) {
    if (!g) continue;
    if (g.type === "time") {
      if (g.pausedRemainingMs != null) time += Math.max(0, Number(g.pausedRemainingMs) || 0);
      else if (g.activeAt && g.expiresAt) time += Math.max(0, Number(g.expiresAt) - now);
      else if (g.durationSeconds) time += Number(g.durationSeconds) * 1000;
    } else if (g.type === "count") {
      uses += Number(g.remainingUses != null ? g.remainingUses : (g.uses || 0));
    }
  }
  session.timeRemainingMs = time;
  session.remainingUses = uses;
  session.timeActiveAt = null;
  session.inConversation = false;
  session.closing = false;
  session.priority = session.priority || "time";
  session.endedConversations = Array.isArray(session.endedConversations) ? session.endedConversations : [];
  session.recoveryCount = Number(session.recoveryCount || 0);
  delete session.grants;
  session.updatedAt = now;
  return true;
}

function settleTime(session, now) {
  if (!session || !session.timeActiveAt) return false;
  const elapsed = Math.max(0, Number(now) - Number(session.timeActiveAt));
  if (elapsed <= 0) return false;
  session.timeRemainingMs = Math.max(0, Number(session.timeRemainingMs || 0) - elapsed);
  session.timeActiveAt = now;
  if (Number(session.timeRemainingMs) <= 0) session.timeActiveAt = null;
  return true;
}

/**
 * 新模型：时长和次数分别汇总，不再排队。
 * 时间只在 chat.html 期间流逝；离开聊天页会自动暂停。
 */
function refreshSession(session, now, startTime) {
  now = now || Date.now();
  let changed = migrateSession(session, now);
  changed = settleTime(session, now) || changed;
  if (startTime && Number(session.timeRemainingMs || 0) > 0 && !session.timeActiveAt) {
    session.timeActiveAt = now;
    changed = true;
  }
  const hasEntitlement = Number(session.timeRemainingMs || 0) > 0 || Number(session.remainingUses || 0) > 0;
  if (!hasEntitlement) {
    session.active = false;
    session.closing = !!session.inConversation;
  } else {
    session.active = !!(session.timeActiveAt || Number(session.remainingUses || 0) > 0);
    if (session.active) session.closing = false;
  }
  session.updatedAt = now;
  return changed;
}

function statusPayload(session, now) {
  now = now || Date.now();
  refreshSession(session, now, false);
  const timeRemainingMs = Math.max(0, Number(session.timeRemainingMs || 0));
  const remainingUses = Math.max(0, Number(session.remainingUses || 0));
  return {
    active: !!session.active,
    available: (timeRemainingMs > 0 || remainingUses > 0) && !session.closing,
    closing: !!session.closing,
    inConversation: !!session.inConversation,
    timeRemainingMs,
    remainingUses,
    timeActive: !!session.timeActiveAt,
    paused: timeRemainingMs > 0 && !session.timeActiveAt,
    priority: session.priority || "time",
    endedConversations: Array.isArray(session.endedConversations) ? session.endedConversations : [],
    // 兼容旧前端字段
    current: null,
    queue: []
  };
}

async function addRecord(env, prefix, data) {
  const key = prefix + Date.now() + ":" + crypto.randomUUID();
  await kvPutJson(env, key, data, { expirationTtl: 180 * 86400 });
}
async function listRecords(env, prefix, limit, offset) {
  const max = Math.max(1, Math.min(Number(limit || 200), 500));
  const skip = Math.max(0, Number(offset || 0));
  const target = Math.min(1000, max + skip);
  const out = [];
  let cursor = null;
  do {
    const res = await env.LICENSE_KV.list({ prefix: prefix, limit: Math.min(1000, target - out.length), cursor: cursor || undefined });
    for (const k of res.keys || []) {
      const v = await kvGetJson(env, k.name);
      if (v) out.push(v);
    }
    cursor = res.cursor || null;
  } while (cursor && out.length < target);
  out.sort((a, b) => Number(b.createdAt || b.redeemedAt || b.usedAt || 0) - Number(a.createdAt || a.redeemedAt || a.usedAt || 0));
  return out.slice(skip, skip + max);
}
function usageCost(usage, env) {
  const inputPrice = Number(env.INPUT_PRICE_PER_M || 1);
  const outputPrice = Number(env.OUTPUT_PRICE_PER_M || 2);
  const promptTokens = Number((usage && usage.prompt_tokens) || 0);
  const completionTokens = Number((usage && usage.completion_tokens) || 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number((usage && usage.total_tokens) || (promptTokens + completionTokens)),
    cost: Number(((promptTokens / 1000000) * inputPrice + (completionTokens / 1000000) * outputPrice).toFixed(6))
  };
}

async function addUsageRecord(env, usage, source, model, knowledgePoint, clientId, token) {
  if (!usage) return;
  const c = usageCost(usage, env);
  await addRecord(env, "usage:", {
    createdAt: Date.now(),
    source: source || "chat",
    model: model || env.DEEPSEEK_MODEL || "deepseek-chat",
    knowledgePoint: knowledgePoint || "",
    promptTokens: c.promptTokens,
    completionTokens: c.completionTokens,
    totalTokens: c.totalTokens,
    cost: c.cost,
    clientId: clientId || "",
    sessionTokenTail: token ? String(token).slice(-8) : ""
  });
}

function sessionAvailable(session) {
  return Number(session.timeRemainingMs || 0) > 0 || Number(session.remainingUses || 0) > 0;
}

async function checkRateLimit(env, bucket, id, limit, windowSec) {
  const now = Date.now();
  const key = "rate:" + bucket + ":" + id + ":" + Math.floor(now / (windowSec * 1000));
  const rateRecord = await kvGetJson(env, key);
  const current = Number(rateRecord && rateRecord.count ? rateRecord.count : 0);
  if (current >= limit) return false;
  await kvPutJson(env, key, { count: current + 1, at: now }, { expirationTtl: windowSec + 60 });
  return true;
}

async function addSystemLog(env, level, event, message, meta) {
  await addRecord(env, "log:", {
    createdAt: Date.now(), level: level || "info", event: event || "system",
    message: message || "", meta: meta || {}
  });
}
function isAdmin(request, env) {
  const expected = String(env.ADMIN_TOKEN || "");
  return !!expected && String(request.headers.get("x-admin-token") || "") === expected;
}
function parseUsageFromSSE(text) {
  let usage = null;
  for (const line of String(text || "").split("\n")) {
    const s = line.trim();
    if (!s.startsWith("data:")) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      if (obj && obj.usage) usage = obj.usage;
    } catch (e) {}
  }
  return usage;
}
const FEEDBACK_STATUSES = ["unread", "solved", "read_unsolved", "invalid"];

async function handleFeedbackSubmit(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkRateLimit(env, "feedback", ip, 5, 3600))) {
    return json({ ok: false, error: "RATE_LIMITED", message: "反馈提交太频繁，请稍后再试。" }, 429, env);
  }
  const content = String(body.content || "").trim().slice(0, 1200);
  const contact = String(body.contact || "").trim().slice(0, 160);
  const image = String(body.image || "");
  const source = ["settings", "chat"].includes(String(body.source || "")) ? String(body.source) : "settings";
  if (!content) return json({ ok: false, error: "CONTENT_REQUIRED", message: "请填写反馈内容。" }, 400, env);
  if (content.length < 1) return json({ ok: false, error: "CONTENT_TOO_SHORT", message: "反馈内容不能为空。" }, 400, env);
  if (image && !image.startsWith("data:image/")) return json({ ok: false, error: "INVALID_IMAGE", message: "图片格式不支持。" }, 400, env);
  if (image.length > 3.2 * 1024 * 1024) return json({ ok: false, error: "IMAGE_TOO_LARGE", message: "图片太大，请压缩后再上传。" }, 413, env);
  const token = String(body.token || "");
  let session = null;
  if (token) session = await kvGetJson(env, "session:" + token);
  const now = Date.now();
  const id = crypto.randomUUID();
  const item = {
    id: id,
    content: content,
    contact: contact,
    image: image,
    source: source,
    status: "unread",
    createdAt: now,
    updatedAt: now,
    tokenTail: token ? token.slice(-8) : "",
    clientId: session ? (session.clientId || "") : "",
    ip: ip,
    userAgent: String(request.headers.get("user-agent") || "").slice(0, 200)
  };
  await kvPutJson(env, "feedback:" + id, item, { expirationTtl: 365 * 86400 });
  await addSystemLog(env, "info", "feedback_submit", "用户提交反馈", { id: id, source: source });
  return json({ ok: true, id: id, status: "unread" }, 200, env);
}

async function handleAdminFeedback(request, env) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "ADMIN_DENIED" }, 401, env);
  const url = new URL(request.url);
  const status = String(url.searchParams.get("status") || "");
  const sort = String(url.searchParams.get("sort") || "newest");
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 500));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  let items = await listRecords(env, "feedback:", 500, 0);
  if (FEEDBACK_STATUSES.includes(status)) items = items.filter(f => f.status === status);
  if (sort === "oldest") items = items.slice().reverse();
  const total = items.length;
  const page = items.slice(offset, offset + limit);
  return json({ ok: true, items: page, total: total, nextOffset: offset + page.length, hasMore: offset + page.length < total }, 200, env);
}

async function handleAdminFeedbackStatus(request, env) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "ADMIN_DENIED" }, 401, env);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!id || !FEEDBACK_STATUSES.includes(status)) {
    return json({ ok: false, error: "INVALID_STATUS", message: "反馈状态无效。" }, 400, env);
  }
  const key = "feedback:" + id;
  const item = await kvGetJson(env, key);
  if (!item) return json({ ok: false, error: "NOT_FOUND", message: "反馈不存在。" }, 404, env);
  item.status = status;
  item.updatedAt = Date.now();
  await kvPutJson(env, key, item, { expirationTtl: 365 * 86400 });
  await addSystemLog(env, "info", "feedback_status", "反馈状态已更新", { id: id, status: status });
  return json({ ok: true, item: item }, 200, env);
}

async function handleAdminLogin(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!(await checkRateLimit(env, "admin_login", ip, 10, 300))) {
    return json({ ok: false, error: "RATE_LIMITED", message: "尝试过于频繁，请稍后再试。" }, 429, env);
  }
  if (!env.ADMIN_TOKEN || String(body.token || "") !== String(env.ADMIN_TOKEN || "")) {
    await addSystemLog(env, "warn", "admin_login_fail", "管理员登录失败", { ip: ip });
    return json({ ok: false, error: "ADMIN_DENIED", message: "管理员口令错误。" }, 401, env);
  }
  await addSystemLog(env, "info", "admin_login_ok", "管理员登录成功", { ip: ip });
  return json({ ok: true }, 200, env);
}
async function handleAdminStats(request, env) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "ADMIN_DENIED" }, 401, env);
  const [redemptions, usage, logs, sessions] = await Promise.all([
    listRecords(env, "redemption:", 1000),
    listRecords(env, "usage:", 1000),
    listRecords(env, "log:", 1000),
    listRecords(env, "session:", 1000)
  ]);
  const totalTokens = usage.reduce((a, u) => a + Number(u.totalTokens || 0), 0);
  const totalCost = usage.reduce((a, u) => a + Number(u.cost || 0), 0);
  const activeSessions = sessions.filter(s => Number(s.timeRemainingMs || 0) > 0 || Number(s.remainingUses || 0) > 0).length;
  const byProduct = {};
  for (const r of redemptions) {
    const k = r.pname || r.pid || "未知套餐";
    byProduct[k] = (byProduct[k] || 0) + 1;
  }
  await addSystemLog(env, "info", "admin_stats", "查看统计", {});
  return json({
    ok: true,
    stats: {
      totalRedemptions: redemptions.length,
      activeSessions,
      totalTokens,
      totalCost: Number(totalCost.toFixed(4)),
      totalUsageRecords: usage.length,
      totalLogs: logs.length,
      byProduct
    }
  }, 200, env);
}
async function handleAdminRedemptions(request, env) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "ADMIN_DENIED" }, 401, env);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 500));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const items = await listRecords(env, "redemption:", limit, offset);
  return json({ ok: true, items: items, nextOffset: offset + items.length, hasMore: items.length === limit }, 200, env);
}
async function handleAdminUsage(request, env) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "ADMIN_DENIED" }, 401, env);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 500));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const items = await listRecords(env, "usage:", limit, offset);
  return json({ ok: true, items: items, nextOffset: offset + items.length, hasMore: items.length === limit }, 200, env);
}
async function handleAdminLogs(request, env) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "ADMIN_DENIED" }, 401, env);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 100), 500));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const items = await listRecords(env, "log:", limit, offset);
  return json({ ok: true, items: items, nextOffset: offset + items.length, hasMore: items.length === limit }, 200, env);
}

async function handleRedeem(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const code = body.code;
  const clientId = String(body.clientId || "").slice(0, 120);
  let payload;
  try { payload = await verifyLicenseCode(code, env); }
  catch (e) { return json({ ok: false, error: "INVALID_CODE", message: e.message }, 400, env); }

  const usedKey = "used:" + payload.jti;
  const used = await kvGetJson(env, usedKey);
  if (used) {
    return json({ ok: false, error: "CODE_ALREADY_USED", message: "该激活码已被使用，不能重复兑换。" }, 409, env);
  }

  const now = Date.now();
  // 注意：KV 是最终一致的，严格并发下仍可能有极小概率竞争。
  // 若要 100% 原子核销，后续可升级为 D1 唯一索引或 Durable Object。
  await kvPutJson(env, usedKey, { jti: payload.jti, usedAt: now, clientId }, { expirationTtl: 60 * 86400 });

  try {
  let session = null;
  let sessionKey = null;
  if (clientId) {
    const mappedToken = await env.LICENSE_KV.get("client:" + clientId);
    if (mappedToken) {
      session = await kvGetJson(env, "session:" + mappedToken);
      sessionKey = "session:" + mappedToken;
    }
  }
  if (!session) {
    session = newSession(clientId);
    sessionKey = "session:" + session.token;
  }
  migrateSession(session, now);
  if (payload.type === "time") {
    session.timeRemainingMs = Number(session.timeRemainingMs || 0) + Number(payload.durationSeconds) * 1000;
    if (session.inConversation && session.priority === "time" && !session.timeActiveAt) session.timeActiveAt = now;
  } else {
    session.remainingUses = Number(session.remainingUses || 0) + Number(payload.uses);
  }
  session.closing = false;
  refreshSession(session, now, session.inConversation);
  await kvPutJson(env, sessionKey, session, { expirationTtl: 90 * 86400 });
  await env.LICENSE_KV.put("code-session:" + payload.jti, session.token, { expirationTtl: 90 * 86400 });
  if (clientId) {
    await env.LICENSE_KV.put("client:" + clientId, session.token, { expirationTtl: 90 * 86400 });
  }
  await addRecord(env, "redemption:", {
    createdAt: now,
    jti: payload.jti,
    pid: payload.pid || "",
    pname: payload.pname || "",
    type: payload.type,
    durationSeconds: payload.durationSeconds || null,
    uses: payload.uses || null,
    clientId: clientId,
    sessionTokenTail: session.token.slice(-8)
  });
  await addSystemLog(env, "info", "redeem", "激活码已兑换", { jti: payload.jti, pid: payload.pid || "" });
  return json({
    ok: true,
    token: session.token,
    added: {
      type: payload.type,
      pid: payload.pid || "",
      pname: payload.pname || "",
      durationSeconds: payload.durationSeconds || null,
      uses: payload.uses || null
    },
    status: statusPayload(session, now)
  }, 200, env);
  } catch (e) {
    await env.LICENSE_KV.delete(usedKey);
    return json({ ok: false, error: "REDEEM_FAILED", message: "激活写入失败，请重试。" }, 500, env);
  }
}

async function handleStatus(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const token = String(body.token || "");
  if (!token) return json({ ok: false, error: "TOKEN_REQUIRED" }, 400, env);
  const session = await kvGetJson(env, "session:" + token);
  if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND", message: "登录状态已失效，请重新输入激活码。" }, 404, env);
  const now = Date.now();
  const changed = refreshSession(session, now, false);
  if (changed) await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
  return json({ ok: true, status: statusPayload(session, now) }, 200, env);
}

function buildSystemPrompt(knowledgePoint, learningGoal, start) {
  const kp = knowledgePoint || "（用户尚未填写知识点）";
  const goal = learningGoal || "（用户未填写具体目标）";
  return `你是“费曼反向学校”里的 AI 学生，而不是老师。用户是讲解者，你的任务是表现出一个需要被教会、会犯错、会追问的学生，直到你真正学会。

【当前知识点】${kp}
【用户学习目标】${goal}
${start ? "【本次任务】请先向讲解者打招呼，并围绕当前知识点提出第一个问题，不要直接讲课。\n" : ""}
【你必须遵守的行为】
1. 先简短回应，再主动追问一个暴露理解盲点的问题。每次回复最多只问一个问题，不要连续抛出多个问题；等用户回答后再问下一个。
2. 故意犯一个符合该知识点的典型错误（混淆概念、用错公式、举反例、只记结论等），让用户纠正你。
3. 至少一次明确要求用户举例子，或用自己的话重新解释。
4. 如果用户讲解含糊、跳跃、自相矛盾、缺少步骤、回避追问，你必须直接说“我还没懂，因为……”，绝对不能顺着说“懂了”“明白了”。
5. 不要长篇讲课，不要替用户总结全部知识；你是一个需要被教会的学生。
6. 回复使用中文，支持 Markdown 和 LaTeX（行内 $...$，独立 $$...$$）。
7. 每次回复最后单独一行输出掌握度标记：[[MASTERY:0-100]]。
8. 只有同时满足以下条件，才允许判定通过：
   (a) 用户覆盖了核心定义/原理；
   (b) 用户说清了为什么或怎么用；
   (c) 用户给了一个正确的例子；
   (d) 用户纠正了你的典型错误；
   (e) 你能用自己的话复述，并做对一道基础小题。
   通过时，在最后单独一行输出：[[PASS]]。未通过时绝对不能输出 [[PASS]]。
9. 如果用户已经讲清楚，你的“复述 + 小题”也要真的做一遍，再判定通过。
10. 如果用户明显在复制粘贴、答非所问或试图让你直接给答案，要指出并继续追问。`;
}

function joinUrl(base, path) {
  return String(base || "").replace(/\/+$/, "") + "/" + String(path || "").replace(/^\/+/, "");
}

async function handleChat(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const token = String(body.token || "");
  if (!token) return json({ ok: false, error: "TOKEN_REQUIRED" }, 400, env);
  const session = await kvGetJson(env, "session:" + token);
  if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND", message: "登录状态已失效，请重新输入激活码。" }, 404, env);

  const now = Date.now();
  session.endedConversations = Array.isArray(session.endedConversations) ? session.endedConversations : [];
  const conversationId = String(body.conversationId || "").slice(0, 80);
  if (conversationId && session.endedConversations.includes(conversationId)) {
    return json({ ok: false, error: "CONVERSATION_ENDED", message: "该对话已彻底结束，不能继续。" }, 403, env);
  }
  const incomingCheck = Array.isArray(body.messages) ? body.messages : [];
  const totalCharsCheck = incomingCheck.reduce((a, m) => a + String((m && m.content) || "").length, 0);
  if (incomingCheck.length > 80 || totalCharsCheck > 50000) {
    return json({ ok: false, error: "TOO_LARGE", message: "对话内容太长，请精简后再发送。" }, 413, env);
  }
  if (!(await checkRateLimit(env, "chat", token, 30, 60))) {
    return json({ ok: false, error: "RATE_LIMITED", message: "请求太频繁，请稍后再试。" }, 429, env);
  }
  session.priority = String(body.priority || session.priority || "time") === "count" ? "count" : "time";
  refreshSession(session, now, false);
  if (session.closing) {
    return json({
      ok: false,
      error: "CURRENT_CONVERSATION_MUST_END",
      message: "时长已到。当前对话只能收尾结束，请点击“结束本次对话”。",
      status: statusPayload(session, now)
    }, 403, env);
  }

  const hasTime = Number(session.timeRemainingMs || 0) > 0 || !!session.timeActiveAt;
  const hasCount = Number(session.remainingUses || 0) > 0;
  let useTime = false;
  let consumedCount = false;
  if (session.priority === "count") {
    if (hasCount) {
      session.remainingUses = Math.max(0, Number(session.remainingUses || 0) - 1);
      consumedCount = true;
    } else if (hasTime) {
      useTime = true;
    }
  } else {
    if (hasTime) {
      useTime = true;
    } else if (hasCount) {
      session.remainingUses = Math.max(0, Number(session.remainingUses || 0) - 1);
      consumedCount = true;
    }
  }
  if (!useTime && !consumedCount) {
    return json({ ok: false, error: "NO_ACTIVE_LICENSE", message: "没有可用时长/次数，请先激活或加时。", status: statusPayload(session, now) }, 402, env);
  }
  session.inConversation = true;
  session.updatedAt = now;
  refreshSession(session, now, useTime);
  await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });

  const knowledgePoint = String(body.knowledgePoint || "");
  const learningGoal = String(body.learningGoal || "");
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const start = !!body.start;
  const cleaned = incoming
    .filter(m => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
    .slice(-36)
    .map(m => ({ role: m.role, content: String(m.content) }));
  const messages = [{ role: "system", content: buildSystemPrompt(knowledgePoint, learningGoal, start) }];
  if (start || cleaned.length === 0) {
    messages.push({
      role: "user",
      content: "（系统提示）请以需要被教会的学生身份，先向讲解者提一个围绕当前知识点的开场问题。不要直接讲课。知识点：" + knowledgePoint
    });
  } else {
    for (const m of cleaned) messages.push(m);
  }
  if (body.hint) {
    messages.push({
      role: "system",
      content: "用户请求提示：请以学生身份，把你上一轮提出的问题解释清楚，用更简单的方式并举一个例子；不要直接替用户总结整个知识点，解释完后再问一个检测理解的小问题。"
    });
  }

  const upstream = await fetch(joinUrl(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", "chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (env.DEEPSEEK_API_KEY || "")
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || "deepseek-chat",
      messages,
      temperature: 0.85,
      max_tokens: 900,
      stream: true
    })
  }).catch(async (e) => {
    if (consumedCount) {
      session.remainingUses = Number(session.remainingUses || 0) + 1;
      await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
    }
    throw e;
  });

  if (!upstream.ok) {
    if (consumedCount) {
      session.remainingUses = Number(session.remainingUses || 0) + 1;
      await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
    }
    const text = await upstream.text().catch(() => "");
    await addSystemLog(env, "error", "chat_upstream", "DeepSeek 对话接口错误", { error: text.slice(0, 1000) });
    return json({ ok: false, error: "UPSTREAM_ERROR", message: "AI 服务暂时不可用，请稍后重试。" }, 502, env);
  }

  const usageText = { value: "" };
  const usageDecoder = new TextDecoder();
  const usageTransform = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      try { usageText.value += usageDecoder.decode(chunk, { stream: true }); } catch (e) {}
    },
    async flush() {
      const usage = parseUsageFromSSE(usageText.value);
      if (!usage) return;
      const c = usageCost(usage, env);
      await addUsageRecord(env, usage, "chat", env.DEEPSEEK_MODEL || "deepseek-chat", knowledgePoint, session.clientId || "", token);
      await addSystemLog(env, "info", "chat_usage", "对话完成并记录用量", {
        totalTokens: c.totalTokens, cost: c.cost
      });
    }
  });

  return new Response(upstream.body.pipeThrough(usageTransform), {
    status: 200,
    headers: Object.assign({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }, corsHeaders(env))
  });
}

async function handleVision(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const token = String(body.token || "");
  let image = String(body.image || "");
  const prompt = String(body.prompt || "请识别图片中的文字，数学公式请用 LaTeX 表示，保留原有排版；只输出识别结果。");
  if (!token) return json({ ok: false, error: "TOKEN_REQUIRED" }, 400, env);
  const session = await kvGetJson(env, "session:" + token);
  if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND", message: "登录状态已失效，请重新激活。" }, 404, env);
  if (!sessionAvailable(session)) return json({ ok: false, error: "NO_ACTIVE_LICENSE", message: "当前没有可用时长/次数，不能使用识图。" }, 402, env);
  if (!(await checkRateLimit(env, "vision", token, 10, 60))) return json({ ok: false, error: "RATE_LIMITED", message: "识图请求太频繁，请稍后再试。" }, 429, env);
  if (!image) return json({ ok: false, error: "IMAGE_REQUIRED", message: "没有收到图片。" }, 400, env);
  if (!image.startsWith("data:image/")) image = "data:image/jpeg;base64," + image;
  if (image.length > 8 * 1024 * 1024) return json({ ok: false, error: "IMAGE_TOO_LARGE", message: "图片太大，请压缩后再试。" }, 413, env);

  const primaryModel = env.DEEPSEEK_VISION_MODEL || "deepseek-v4-flash-vision-exp";
  const fallbackModel = env.DEEPSEEK_VISION_MODEL_FALLBACK || "deepseek-flash";
  const models = [primaryModel];
  if (fallbackModel && fallbackModel !== primaryModel) models.push(fallbackModel);
  let upstream = null;
  let usedModel = primaryModel;
  let lastError = "";
  for (const m of models) {
    usedModel = m;
    upstream = await fetch(joinUrl(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", "chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (env.DEEPSEEK_API_KEY || "")
      },
      body: JSON.stringify({
        model: m,
        messages: [
          { role: "system", content: "你是 OCR 助手。请识别图片中的文字，把数学公式转为 LaTeX，保留排版结构；只输出识别结果，不要解释。" },
          { role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image } }
          ] }
        ],
        temperature: 0.1,
        max_tokens: 2000,
        stream: false
      })
    });
    if (upstream.ok) break;
    lastError = await upstream.text().catch(() => "");
  }
  if (!upstream || !upstream.ok) {
    await addSystemLog(env, "error", "vision_upstream", "DeepSeek 识图接口错误", { model: usedModel, error: lastError.slice(0, 1000) });
    return json({ ok: false, error: "UPSTREAM_ERROR", message: "识图服务暂时不可用，请稍后重试。" }, 502, env);
  }
  const data = await upstream.json().catch(() => null);
  const text = data && data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || "") : "";
  if (!text) return json({ ok: false, error: "EMPTY_RESULT", message: "DeepSeek 没有返回识别结果。" }, 502, env);
  await addUsageRecord(env, data && data.usage, "vision", usedModel, "", session.clientId || "", token);
  await addSystemLog(env, "info", "vision_ocr", "DeepSeek 识图完成", { model: usedModel });
  return json({ ok: true, text: text, model: model }, 200, env);
}

async function handleCleanText(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const token = String(body.token || "");
  const text = String(body.text || "").slice(0, 6000);
  if (!token) return json({ ok: false, error: "TOKEN_REQUIRED" }, 400, env);
  if (!text.trim()) return json({ ok: false, error: "EMPTY_TEXT", message: "没有可整理的内容。" }, 400, env);
  const session = await kvGetJson(env, "session:" + token);
  if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND", message: "登录状态已失效，请重新激活。" }, 404, env);
  if (!sessionAvailable(session)) return json({ ok: false, error: "NO_ACTIVE_LICENSE", message: "当前没有可用时长/次数，不能使用 AI 整理。" }, 402, env);
  if (!(await checkRateLimit(env, "clean", token, 20, 60))) return json({ ok: false, error: "RATE_LIMITED", message: "整理请求太频繁，请稍后再试。" }, 429, env);
  const upstream = await fetch(joinUrl(env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", "chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + (env.DEEPSEEK_API_KEY || "")
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || "deepseek-chat",
      messages: [
        { role: "system", content: "你是 OCR 公式整理助手。把用户提供的 OCR 文本整理成规范的 Markdown + LaTeX：数学公式用 $...$ 或 $$...$$，不要讲解，不要添加原文没有的内容，只输出整理后的文本。" },
        { role: "user", content: text }
      ],
      temperature: 0.1,
      max_tokens: 1600,
      stream: false
    })
  });
  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    await addSystemLog(env, "error", "clean_upstream", "AI 整理接口错误", { error: errText.slice(0, 1000) });
    return json({ ok: false, error: "UPSTREAM_ERROR", message: "整理服务暂时不可用，请稍后重试。" }, 502, env);
  }
  const data = await upstream.json().catch(() => null);
  const cleaned = data && data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || "") : "";
  if (!cleaned) return json({ ok: false, error: "EMPTY_RESULT", message: "AI 没有返回整理结果。" }, 502, env);
  await addUsageRecord(env, data && data.usage, "ocr_clean", env.DEEPSEEK_MODEL || "deepseek-chat", "", session.clientId || "", token);
  await addSystemLog(env, "info", "ocr_clean", "OCR 文本 AI 整理完成", { length: text.length });
  return json({ ok: true, text: cleaned }, 200, env);
}

async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const code = body.code;
  let payload;
  try { payload = await verifyLicenseCode(code, env, true); }
  catch (e) { return json({ ok: false, error: "INVALID_CODE", message: e.message }, 400, env); }
  const used = await kvGetJson(env, "used:" + payload.jti);
  if (!used) return json({ ok: false, error: "CODE_NOT_REDEEMED", message: "该激活码还没有兑换过，请先激活。" }, 404, env);
  const token = await env.LICENSE_KV.get("code-session:" + payload.jti);
  if (!token) return json({ ok: false, error: "SESSION_NOT_FOUND", message: "该激活码对应的会话已失效，请重新购买。" }, 404, env);
  const session = await kvGetJson(env, "session:" + token);
  if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND", message: "该激活码对应的会话已失效，请重新购买。" }, 404, env);
  if (Number(session.recoveryCount || 0) >= 20) {
    return json({ ok: false, error: "RECOVERY_LIMITED", message: "该账号恢复次数已达上限，请联系客服。" }, 429, env);
  }
  const now = Date.now();
  session.recoveryCount = Number(session.recoveryCount || 0) + 1;
  refreshSession(session, now, false);
  await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
  return json({ ok: true, token: token, status: statusPayload(session, now) }, 200, env);
}

async function handlePause(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const token = String(body.token || "");
  if (!token) return json({ ok: false, error: "TOKEN_REQUIRED" }, 400, env);
  const session = await kvGetJson(env, "session:" + token);
  if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND", message: "登录状态已失效，请重新输入激活码。" }, 404, env);
  const now = Date.now();
  refreshSession(session, now, false);
  session.timeActiveAt = null;
  session.inConversation = false;
  session.updatedAt = now;
  await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
  return json({ ok: true, status: statusPayload(session, now) }, 200, env);
}

async function handleStart(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const token = String(body.token || "");
  if (!token) return json({ ok: false, error: "TOKEN_REQUIRED" }, 400, env);
  const session = await kvGetJson(env, "session:" + token);
  if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND", message: "登录状态已失效，请重新输入激活码。" }, 404, env);
  const now = Date.now();
  session.endedConversations = Array.isArray(session.endedConversations) ? session.endedConversations : [];
  const conversationId = String(body.conversationId || "").slice(0, 80);
  if (conversationId && session.endedConversations.includes(conversationId)) {
    return json({ ok: false, error: "CONVERSATION_ENDED", message: "该对话已彻底结束，不能继续。" }, 403, env);
  }
  session.priority = String(body.priority || session.priority || "time") === "count" ? "count" : "time";
  session.inConversation = true;
  session.updatedAt = now;
  const shouldStartTime = session.priority !== "count" || Number(session.remainingUses || 0) <= 0;
  refreshSession(session, now, shouldStartTime);
  await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
  return json({ ok: true, status: statusPayload(session, now) }, 200, env);
}

async function handleEnd(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const token = String(body.token || "");
  if (!token) return json({ ok: false, error: "TOKEN_REQUIRED" }, 400, env);
  const session = await kvGetJson(env, "session:" + token);
  if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND" }, 404, env);
  const now = Date.now();
  session.endedConversations = Array.isArray(session.endedConversations) ? session.endedConversations : [];
  const conversationId = String(body.conversationId || "").slice(0, 80);
  if (conversationId && !session.endedConversations.includes(conversationId)) {
    session.endedConversations.push(conversationId);
  }
  refreshSession(session, now, false);
  session.timeActiveAt = null;
  session.inConversation = false;
  session.closing = false;
  session.updatedAt = now;
  await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
  return json({ ok: true, status: statusPayload(session, now) }, 200, env);
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }
  if (path === "/api/health" && request.method === "GET") {
    return json({ ok: true, service: "feynman-reverse-school-api", time: Date.now() }, 200, env);
  }
  if (path === "/api/redeem" && request.method === "POST") return handleRedeem(request, env);
  if (path === "/api/status" && request.method === "POST") return handleStatus(request, env);
  if (path === "/api/pause" && request.method === "POST") return handlePause(request, env);
  if (path === "/api/vision" && request.method === "POST") return handleVision(request, env);
  if (path === "/api/clean-text" && request.method === "POST") return handleCleanText(request, env);
  if (path === "/api/feedback" && request.method === "POST") return handleFeedbackSubmit(request, env);
  if (path === "/api/admin/feedback" && request.method === "GET") return handleAdminFeedback(request, env);
  if (path === "/api/admin/feedback/status" && request.method === "POST") return handleAdminFeedbackStatus(request, env);
  if (path === "/api/login" && request.method === "POST") return handleLogin(request, env);
  if (path === "/api/start" && request.method === "POST") return handleStart(request, env);
  if (path === "/api/chat" && request.method === "POST") return handleChat(request, env);
  if (path === "/api/end" && request.method === "POST") return handleEnd(request, env);
  if (path === "/api/admin/login" && request.method === "POST") return handleAdminLogin(request, env);
  if (path === "/api/admin/stats" && request.method === "GET") return handleAdminStats(request, env);
  if (path === "/api/admin/redemptions" && request.method === "GET") return handleAdminRedemptions(request, env);
  if (path === "/api/admin/usage" && request.method === "GET") return handleAdminUsage(request, env);
  if (path === "/api/admin/logs" && request.method === "GET") return handleAdminLogs(request, env);
  return json({ ok: false, error: "NOT_FOUND" }, 404, env);
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};
