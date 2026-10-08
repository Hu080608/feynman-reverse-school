/* 前端后端 API 封装：所有授权、状态、对话都走后端，API Key 不落前端。 */
(function () {
  const cfg = window.APP_CONFIG;
  function baseUrl() {
    const u = (cfg.BACKEND && cfg.BACKEND.url) || "";
    return String(u).replace(/\/+$/, "");
  }
  async function postJson(path, body) {
    const url = baseUrl() + path;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
    } catch (e) {
      throw new Error("无法连接后端服务：" + (e && e.message ? e.message : e));
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && (data.message || data.error)) || ("后端错误 " + res.status));
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  async function redeem(code, clientId) {
    return postJson("/api/redeem", { code: code, clientId: clientId });
  }
  async function login(code) {
    return postJson("/api/login", { code: code });
  }
  async function status(token) {
    return postJson("/api/status", { token: token });
  }
  async function start(token, priority, conversationId) {
    return postJson("/api/start", { token: token, priority: priority || "time", conversationId: conversationId || "" });
  }
  async function pause(token) {
    return postJson("/api/pause", { token: token });
  }
  async function end(token, conversationId) {
    return postJson("/api/end", { token: token, conversationId: conversationId || "" });
  }

  async function cleanText(token, text) {
    return postJson("/api/clean-text", { token: token, text: text });
  }
  async function vision(token, image, prompt) {
    return postJson("/api/vision", { token: token, image: image, prompt: prompt || "" });
  }
  async function feedback(payload) {
    return postJson("/api/feedback", payload || {});
  }

  async function chat(token, payload, onDelta) {
    const url = baseUrl() + "/api/chat";
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ token: token }, payload || {}))
      });
    } catch (e) {
      throw new Error("无法连接后端服务：" + (e && e.message ? e.message : e));
    }

    if (!res.ok) {
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) {}
      const err = new Error((data && (data.message || data.error)) || ("对话请求失败 " + res.status));
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    if (!res.body) throw new Error("当前浏览器不支持流式读取。");

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let full = "";
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      buffer += decoder.decode(r.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const payloadText = s.slice(5).trim();
        if (payloadText === "[DONE]") continue;
        let chunk;
        try { chunk = JSON.parse(payloadText); } catch (e) { continue; }
        const delta = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        const content = delta && delta.content ? delta.content : "";
        if (content) {
          full += content;
          if (onDelta) onDelta(content, full);
        }
      }
    }
    return full;
  }

  window.FeynmanBackend = { redeem, login, cleanText, vision, feedback, status, start, pause, end, chat, baseUrl };
})();
