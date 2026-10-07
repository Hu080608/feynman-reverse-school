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

async function verifyLicenseCode(code, env) {
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
  if (payload.exp && now > Number(payload.exp) * 1000) throw new Error("激活码已超过激活有效期。");
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
    grants: []
  };
}

function makeGrant(payload, now) {
  const base = {
    id: payload.jti,
    pid: payload.pid || "",
    pname: payload.pname || "",
    type: payload.type,
    addedAt: now,
    status: "pending"
  };
  if (payload.type === "time") {
    base.durationSeconds = Number(payload.durationSeconds);
    base.activeAt = null;
    base.expiresAt = null;
  } else {
    base.uses = Number(payload.uses);
    base.remainingUses = Number(payload.uses);
  }
  return base;
}

/**
 * 刷新套餐队列：
 * - 时间套餐：从它成为队首时开始计时，不暂停；到期后自动出队并启用下一个。
 * - 次数套餐：队首时开始扣次，次数为 0 后出队并启用下一个。
 * - 当前没有更多套餐且用户还在对话中时，标记 closing，只允许用户结束本次对话。
 */
function startTimeGrant(g, startAt) {
  g.activeAt = Number(startAt) || Date.now();
  g.expiresAt = g.activeAt + Number(g.durationSeconds) * 1000;
  g.status = "active";
}

/**
 * 刷新套餐队列。
 * startTime=false：时间套餐没开始时保持 pending，不自动计时。
 * startTime=true：用户进入 chat.html 或发消息时，启动队首的时间套餐。
 * 时间套餐不暂停：上一位到期后，下一位从上一位到期时间接着计时。
 */
function refreshSession(session, now, startTime) {
  now = now || Date.now();
  let changed = false;
  while (session.grants && session.grants.length) {
    const g = session.grants[0];
    if (g.type === "time") {
      if (!g.activeAt) {
        if (g.pausedRemainingMs != null) {
          if (startTime) {
            startTimeGrant(g, now);
            g.expiresAt = now + Number(g.pausedRemainingMs);
            g.pausedRemainingMs = null;
            changed = true;
          } else {
            g.status = "paused";
          }
          break;
        }
        if (startTime) {
          startTimeGrant(g, now);
          changed = true;
        } else {
          g.status = "pending";
        }
        break;
      }
      if (now < Number(g.expiresAt)) {
        g.status = "active";
        break;
      }
      // 当前时间套餐到期，记录到期时间，下一位时间套餐接着算
      const expiredAt = Number(g.expiresAt) || now;
      g.status = "done";
      session.grants.shift();
      changed = true;
      const next = session.grants[0];
      if (next && next.type === "time" && !next.activeAt) {
        startTimeGrant(next, expiredAt);
        changed = true;
        continue;
      }
      continue;
    }
    if (g.remainingUses == null) g.remainingUses = Number(g.uses);
    if (Number(g.remainingUses) > 0) {
      g.status = "active";
      break;
    }
    g.status = "done";
    session.grants.shift();
    changed = true;
    const nextCountGrant = session.grants[0];
    if (nextCountGrant && nextCountGrant.type === "time" && !nextCountGrant.activeAt && session.inConversation) {
      startTimeGrant(nextCountGrant, now);
      changed = true;
      continue;
    }
  }
  if (!session.grants || session.grants.length === 0) {
    session.active = false;
    session.closing = !!session.inConversation;
  } else {
    const g = session.grants[0];
    const active = g.type === "count"
      ? Number(g.remainingUses || 0) > 0
      : !!(g.activeAt && now < Number(g.expiresAt));
    session.active = active;
    if (active) session.closing = false;
  }
  session.updatedAt = now;
  return changed;
}

function statusPayload(session, now) {
  now = now || Date.now();
  refreshSession(session, now, false);
  const current = session.grants && session.grants[0] ? session.grants[0] : null;
  const queue = (session.grants || []).map(g => {
    const item = { id: g.id, pid: g.pid, pname: g.pname, type: g.type, status: g.status };
    if (g.type === "time") item.remainingMs = g.pausedRemainingMs != null ? Number(g.pausedRemainingMs) : (g.activeAt && g.expiresAt ? Math.max(0, Number(g.expiresAt) - now) : null);
    else item.remainingUses = Number(g.remainingUses || 0);
    return item;
  });
  let remainingMs = null;
  let remainingUses = null;
  if (current && current.type === "time") {
    if (current.pausedRemainingMs != null) remainingMs = Number(current.pausedRemainingMs);
    else if (current.activeAt && current.expiresAt) remainingMs = Math.max(0, Number(current.expiresAt) - now);
  }
  if (current && current.type === "count") remainingUses = Number(current.remainingUses || 0);
  const pendingTime = !!(current && current.type === "time" && current.status === "pending");
  const pausedTime = !!(current && current.type === "time" && current.status === "paused");
  return {
    active: !!(current && current.status === "active" && !session.closing),
    available: !!(current && !session.closing),
    pendingTime: pendingTime,
    pausedTime: pausedTime,
    closing: !!session.closing,
    inConversation: !!session.inConversation,
    current: current ? {
      id: current.id,
      pid: current.pid,
      pname: current.pname,
      type: current.type,
      status: current.status || (current.activeAt ? "active" : "pending"),
      remainingMs,
      remainingUses,
      expiresAt: current.expiresAt || null
    } : null,
    queue,
    canEnd: true
  };
}

async function addRecord(env, prefix, data) {
  const key = prefix + Date.now() + ":" + crypto.randomUUID();
  await kvPutJson(env, key, data, { expirationTtl: 180 * 86400 });
}
async function listRecords(env, prefix, limit) {
  const max = Math.max(1, Math.min(Number(limit || 500), 1000));
  const out = [];
  let cursor = null;
  do {
    const res = await env.LICENSE_KV.list({ prefix: prefix, limit: Math.min(1000, max - out.length), cursor: cursor || undefined });
    for (const k of res.keys || []) {
      const v = await kvGetJson(env, k.name);
      if (v) out.push(v);
    }
    cursor = res.cursor || null;
  } while (cursor && out.length < max);
  out.sort((a, b) => Number(b.createdAt || b.redeemedAt || b.usedAt || 0) - Number(a.createdAt || a.redeemedAt || a.usedAt || 0));
  return out;
}
async function addSystemLog(env, level, event, message, meta) {
  await addRecord(env, "log:", {
    createdAt: Date.now(), level: level || "info", event: event || "system",
    message: message || "", meta: meta || {}
  });
}
function isAdmin(request, env) {
  return String(request.headers.get("x-admin-token") || "") === String(env.ADMIN_TOKEN || "");
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
async function handleAdminLogin(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { body = {}; }
  if (String(body.token || "") !== String(env.ADMIN_TOKEN || "")) {
    return json({ ok: false, error: "ADMIN_DENIED", message: "管理员口令错误。" }, 401, env);
  }
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
  const activeSessions = sessions.filter(s => s.active).length;
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
  const limit = Number(url.searchParams.get("limit") || 200);
  return json({ ok: true, items: await listRecords(env, "redemption:", limit) }, 200, env);
}
async function handleAdminUsage(request, env) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "ADMIN_DENIED" }, 401, env);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 200);
  return json({ ok: true, items: await listRecords(env, "usage:", limit) }, 200, env);
}
async function handleAdminLogs(request, env) {
  if (!isAdmin(request, env)) return json({ ok: false, error: "ADMIN_DENIED" }, 401, env);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 200);
  return json({ ok: true, items: await listRecords(env, "log:", limit) }, 200, env);
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
  session.grants.push(makeGrant(payload, now));
  session.closing = false;
  refreshSession(session, now, false);
  await kvPutJson(env, sessionKey, session, { expirationTtl: 90 * 86400 });
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
    status: statusPayload(session, now)
  }, 200, env);
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
  refreshSession(session, now, true);
  if (session.closing) {
    return json({
      ok: false,
      error: "CURRENT_CONVERSATION_MUST_END",
      message: "时长已到。当前对话只能收尾结束，请点击“结束本次对话”。",
      status: statusPayload(session, now)
    }, 403, env);
  }
  if (!session.active || !session.grants || !session.grants.length) {
    return json({ ok: false, error: "NO_ACTIVE_LICENSE", message: "没有可用时长/次数，请先激活或加时。", status: statusPayload(session, now) }, 402, env);
  }

  const current = session.grants[0];
  let consumedCount = false;
  if (current.type === "count") {
    if (Number(current.remainingUses || 0) <= 0) {
      refreshSession(session, now, true);
      return json({ ok: false, error: "NO_ACTIVE_LICENSE", message: "次数已用完，请激活新的次数套餐。", status: statusPayload(session, now) }, 402, env);
    }
    current.remainingUses = Number(current.remainingUses) - 1;
    consumedCount = true;
  }
  session.inConversation = true;
  session.updatedAt = now;
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
      current.remainingUses = Number(current.remainingUses) + 1;
      await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
    }
    throw e;
  });

  if (!upstream.ok) {
    if (consumedCount) {
      current.remainingUses = Number(current.remainingUses) + 1;
      await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
    }
    const text = await upstream.text().catch(() => "");
    return json({ ok: false, error: "UPSTREAM_ERROR", message: "DeepSeek 接口错误：" + text.slice(0, 400) }, 502, env);
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
      const inputPrice = Number(env.INPUT_PRICE_PER_M || 1);
      const outputPrice = Number(env.OUTPUT_PRICE_PER_M || 2);
      const promptTokens = Number(usage.prompt_tokens || 0);
      const completionTokens = Number(usage.completion_tokens || 0);
      const totalTokens = Number(usage.total_tokens || (promptTokens + completionTokens));
      const cost = (promptTokens / 1000000) * inputPrice + (completionTokens / 1000000) * outputPrice;
      await addRecord(env, "usage:", {
        createdAt: Date.now(),
        model: env.DEEPSEEK_MODEL || "deepseek-chat",
        knowledgePoint: knowledgePoint,
        promptTokens, completionTokens, totalTokens,
        cost: Number(cost.toFixed(6)),
        clientId: session.clientId || "",
        sessionTokenTail: token.slice(-8)
      });
      await addSystemLog(env, "info", "chat_usage", "对话完成并记录用量", {
        totalTokens, cost: Number(cost.toFixed(6))
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

async function handlePause(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: "INVALID_JSON" }, 400, env); }
  const token = String(body.token || "");
  if (!token) return json({ ok: false, error: "TOKEN_REQUIRED" }, 400, env);
  const session = await kvGetJson(env, "session:" + token);
  if (!session) return json({ ok: false, error: "SESSION_NOT_FOUND", message: "登录状态已失效，请重新输入激活码。" }, 404, env);
  const now = Date.now();
  refreshSession(session, now, false);
  const g = session.grants && session.grants[0];
  if (g && g.type === "time" && g.activeAt && g.expiresAt && now < Number(g.expiresAt)) {
    g.pausedRemainingMs = Math.max(0, Number(g.expiresAt) - now);
    g.activeAt = null;
    g.expiresAt = null;
    g.status = "paused";
  }
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
  session.inConversation = true;
  session.updatedAt = now;
  refreshSession(session, now, true);
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
  session.inConversation = false;
  session.closing = false;
  session.updatedAt = Date.now();
  refreshSession(session, session.updatedAt, false);
  await kvPutJson(env, "session:" + token, session, { expirationTtl: 90 * 86400 });
  return json({ ok: true, status: statusPayload(session, session.updatedAt) }, 200, env);
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
