/* 前端授权校验层：只包含“验证公钥/签名”和本地授权状态计算，不包含签发私钥。 */
(function () {
  const cfg = window.APP_CONFIG;
  const enc = new TextEncoder();

  function b64urlToBytes(s) {
    s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function b64urlToString(s) {
    return new TextDecoder().decode(b64urlToBytes(s));
  }

  async function verifyEcdsa(payloadText, sigBytes) {
    const jwk = cfg.AUTH.publicKeyJwk;
    if (!jwk || !jwk.x || !jwk.y) throw new Error("未配置 AUTH.publicKeyJwk，无法校验 ECDSA 激活码。");
    const key = await crypto.subtle.importKey(
      "jwk",
      Object.assign({}, jwk, { kty: "EC", crv: jwk.crv || "P-256", ext: true }),
      { name: "ECDSA", namedCurve: jwk.crv || "P-256" },
      false,
      ["verify"]
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sigBytes,
      enc.encode(payloadText)
    );
  }

  async function verifyHmac(payloadText, sigBytes) {
    const secret = cfg.AUTH.hmacSecret;
    if (!secret) throw new Error("未配置 AUTH.hmacSecret，无法校验 HMAC 激活码。");
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    return crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payloadText));
  }

  async function verifyCode(code) {
    const raw = String(code || "").trim().replace(/\s+/g, "");
    if (!raw) throw new Error("请输入激活码。");
    const parts = raw.split(".");
    if (parts.length !== 2) throw new Error("激活码格式不正确：应为 载荷.签名。");
    let payloadText;
    let sigBytes;
    try {
      payloadText = b64urlToString(parts[0]);
      sigBytes = b64urlToBytes(parts[1]);
    } catch (e) {
      throw new Error("激活码编码损坏，请重新复制完整内容。");
    }
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch (e) {
      throw new Error("激活码载荷无法解析，可能已损坏。");
    }
    const mode = cfg.AUTH.mode || "ecdsa";
    let ok = false;
    if (mode === "hmac") ok = await verifyHmac(payloadText, sigBytes);
    else ok = await verifyEcdsa(payloadText, sigBytes);
    if (!ok) throw new Error("激活码签名无效，请检查是否复制完整或联系卖家。");

    const now = Date.now();
    if (payload.v !== 1) throw new Error("激活码版本不支持。");
    if (!["time", "count"].includes(payload.type)) throw new Error("激活码类型无效。");
    if (payload.type === "time" && !(Number(payload.durationSeconds) > 0)) {
      throw new Error("激活码时长无效。");
    }
    if (payload.type === "count" && !(Number(payload.uses) > 0)) {
      throw new Error("激活码次数无效。");
    }
    if (payload.exp && now > Number(payload.exp) * 1000) {
      throw new Error("激活码已过有效期，不能继续激活。");
    }
    if (payload.nbf && now < Number(payload.nbf) * 1000) {
      throw new Error("激活码尚未生效。");
    }
    return payload;
  }

  function emptyLicense() {
    return {
      active: false,
      activatedAt: null,
      expiresAt: null,
      remainingUses: null,
      grants: [],
      lastSeenAt: Date.now(),
      clockAnomaly: false,
      finishConversation: false,
      updatedAt: Date.now()
    };
  }

  function normalizeLicense(lic) {
    const base = emptyLicense();
    if (!lic || typeof lic !== "object") return base;
    return Object.assign(base, lic, { grants: Array.isArray(lic.grants) ? lic.grants : [] });
  }

  function hasTime(lic, now) {
    return !!(lic && lic.expiresAt && now < Number(lic.expiresAt));
  }
  function hasCount(lic, now) {
    return !!(lic && Number(lic.remainingUses) > 0);
  }
  function isActive(lic, now) {
    return hasTime(lic, now) || hasCount(lic, now);
  }

  function applyCode(current, payload, now) {
    now = now || Date.now();
    const lic = normalizeLicense(current);
    const grant = {
      jti: payload.jti || "",
      pid: payload.pid || "",
      pname: payload.pname || "",
      type: payload.type,
      activatedAt: now,
      payload: payload
    };
    if (payload.type === "time") {
      const add = Number(payload.durationSeconds) * 1000;
      // 加时规则：有效期内的同一时间套餐，在“当前到期时间”上叠加；已过期则从本次激活重新起算。
      lic.expiresAt = hasTime(lic, now) ? Number(lic.expiresAt) + add : now + add;
      lic.active = true;
    } else {
      lic.remainingUses = Math.max(0, Number(lic.remainingUses || 0)) + Number(payload.uses);
      lic.active = true;
    }
    lic.activatedAt = lic.activatedAt || now;
    lic.lastSeenAt = now;
    lic.clockAnomaly = false;
    lic.grants.push(grant);
    lic.updatedAt = now;
    return lic;
  }

  function consumeUse(current, now) {
    now = now || Date.now();
    const lic = normalizeLicense(current);
    // 有剩余时长时优先走时长，不扣次数；只有纯次数套餐才扣。
    if (hasTime(lic, now)) return lic;
    if (hasCount(lic, now)) {
      lic.remainingUses = Math.max(0, Number(lic.remainingUses) - 1);
      if (lic.remainingUses === 0) lic.active = false;
    }
    lic.updatedAt = now;
    return lic;
  }

  function timeRemainingMs(lic, now) {
    now = now || Date.now();
    if (!lic || !lic.expiresAt) return 0;
    return Math.max(0, Number(lic.expiresAt) - now);
  }

  function detectClockRollback(lic, now) {
    now = now || Date.now();
    if (!lic || !lic.lastSeenAt) return false;
    const tolerance = Number(cfg.AUTH.clockRollbackToleranceMs || 120000);
    return now + tolerance < Number(lic.lastSeenAt);
  }

  window.FeynmanAuth = {
    verifyCode,
    emptyLicense,
    normalizeLicense,
    hasTime,
    hasCount,
    isActive,
    applyCode,
    consumeUse,
    timeRemainingMs,
    detectClockRollback
  };
})();
