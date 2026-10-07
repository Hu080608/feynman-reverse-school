/* 费曼反向学校：页面逻辑、会话持久化、AI 学生交互、套餐授权与 OCR。 */
(function () {
  const cfg = window.APP_CONFIG;
  const A = window.FeynmanAuth;
  const API = window.FeynmanAPI;
  const B = window.FeynmanBackend;
  const PAGE = (document.body && document.body.getAttribute("data-page")) || "settings";

  const $ = (id) => document.getElementById(id);
  const els = {
    knowledgePoint: $("knowledgePoint"), learningGoal: $("learningGoal"),
    newChatBtn: $("newChatBtn"), continueBtn: $("continueBtn"), sessionSelect: $("sessionSelect"),
    openSessionBtn: $("openSessionBtn"), activationCode: $("activationCode"), activateBtn: $("activateBtn"),
    activationMsg: $("activationMsg"), masteryBar: $("masteryBar"), masteryText: $("masteryText"),
    passBadge: $("passBadge"), queueInfo: $("queueInfo"), imageInput: $("imageInput"), ocrBtn: $("ocrBtn"), ocrStatus: $("ocrStatus"),
    ocrText: $("ocrText"), insertOcrBtn: $("insertOcrBtn"), chatTitle: $("chatTitle"),
    chatSubtitle: $("chatSubtitle"), chatMessages: $("chatMessages"), apiError: $("apiError"),
    userInput: $("userInput"), sendBtn: $("sendBtn"), retryBtn: $("retryBtn"), endSessionBtn: $("endSessionBtn"),
    licensePill: $("licensePill"), timePill: $("timePill"), passPill: $("passPill"), toast: $("toast"),
    sidebar: $("sidebar"), sidebarToggle: $("sidebarToggle"), sidebarClose: $("sidebarClose"),
    sidebarBackdrop: $("sidebarBackdrop"), lockHint: $("lockHint"), backSettingsBtn: $("backSettingsBtn"),
    setupStep1: $("setupStep1"), setupStep2: $("setupStep2"), setupStep3: $("setupStep3"), setupHint: $("setupHint")
  };

  let state = loadState();
  let sending = false;
  let lastPersist = 0;
  let lastStatusRefresh = 0;

  /* ---------------- 持久化与会话 ---------------- */
  function defaultState() {
    return { version: 2, currentSessionId: null, sessions: {}, license: A.emptyLicense(), usedCodeIds: [], backendToken: "", backendStatus: null, backendStatusAt: 0 };
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(cfg.APP.storageKey);
      if (!raw) return defaultState();
      const obj = JSON.parse(raw);
      return Object.assign(defaultState(), obj, {
        sessions: obj.sessions && typeof obj.sessions === "object" ? obj.sessions : {},
        license: A.normalizeLicense(obj.license),
        usedCodeIds: Array.isArray(obj.usedCodeIds) ? obj.usedCodeIds : [],
        backendToken: typeof obj.backendToken === "string" ? obj.backendToken : "",
        backendStatus: obj.backendStatus || null,
        backendStatusAt: Number(obj.backendStatusAt || 0)
      });
    } catch (e) {
      console.warn("读取本地状态失败", e);
      return defaultState();
    }
  }
  function saveState() {
    try { localStorage.setItem(cfg.APP.storageKey, JSON.stringify(state)); }
    catch (e) { console.warn("保存本地状态失败", e); }
  }
  function uid() {
    return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }
  function getClientId() {
    let id = localStorage.getItem(cfg.APP.storageKey + "_client_id");
    if (!id) {
      id = "c_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(cfg.APP.storageKey + "_client_id", id);
    }
    return id;
  }
  function backendReady() {
    return !!(B && cfg.BACKEND && cfg.BACKEND.url);
  }
  function backendActive() {
    const st = state.backendStatus;
    if (!st) return false;
    const available = st.available != null ? st.available : st.active;
    return !!(available && !st.closing);
  }
  function isReadonlyMode() {
    return PAGE === "chat" && sessionStorage.getItem("feynman_readonly") === "1";
  }
  function clearReadonlyMode() {
    try { sessionStorage.removeItem("feynman_readonly"); } catch (e) {}
  }
  function backendClosing() {
    return !!(state.backendStatus && state.backendStatus.closing);
  }
  async function refreshStatus(silent) {
    if (!backendReady() || !state.backendToken) { state.backendStatus = null; return; }
    try {
      const res = await B.status(state.backendToken);
      state.backendStatus = res.status || null;
      state.backendStatusAt = Date.now();
      saveState();
      renderTimer();
      return state.backendStatus;
    } catch (e) {
      if (!silent) toast(e && e.message ? e.message : "授权状态刷新失败");
      if (e && (e.status === 404 || /SESSION_NOT_FOUND|登录状态已失效/.test(e.message || ""))) {
        state.backendToken = "";
        state.backendStatus = null;
        saveState();
      }
      renderTimer();
      throw e;
    }
  }
  async function startChatSession() {
    if (!backendReady() || !state.backendToken) return false;
    try {
      const res = await B.start(state.backendToken);
      state.backendStatus = res.status || null;
      state.backendStatusAt = Date.now();
      saveState();
      renderTimer();
      maybeStartAi(currentSession());
      return true;
    } catch (e) {
      showApiError(e && e.message ? e.message : "无法开始本次对话。");
      return false;
    }
  }

  function maybeStartAi(s) {
    if (!s || s.messages.length > 0 || sending) return;
    if (backendActive()) requestAi(s, true);
    else if (!backendReady()) toast("后端未配置，无法发起对话。");
  }
  function openSidebar() {
    if (!els.sidebar) return;
    els.sidebar.classList.add("open");
    if (els.sidebarBackdrop) els.sidebarBackdrop.classList.add("show");
  }
  function closeSidebar() {
    if (!els.sidebar) return;
    els.sidebar.classList.remove("open");
    if (els.sidebarBackdrop) els.sidebarBackdrop.classList.remove("show");
  }
  function canEnterChat() {
    const s = currentSession();
    if (!backendReady()) { toast("后端未配置，无法进入对话。"); return false; }
    if (!state.backendToken) { toast("请先输入激活码。"); return false; }
    if (!backendActive()) { toast("当前没有可用时长/次数，请先激活或加时。"); return false; }
    if (!s) { toast("请先填写知识点并点击“开始新对话”。"); return false; }
    if (!s.knowledgePoint || !String(s.knowledgePoint).trim()) { toast("请先填写知识点。"); return false; }
    if (s.endedAt) { toast("该对话已结束，请开始新的对话。"); return false; }
    return true;
  }
  function showChat() {
    if (!canEnterChat()) return;
    location.href = "chat.html";
  }
  function showSettings() {
    clearReadonlyMode();
    location.href = "index.html";
  }
  function openSessionAction(s) {
    if (!s) return;
    state.currentSessionId = s.id;
    saveState(); renderAll();
    if (backendActive()) {
      if (s.endedAt) {
        if (!confirm("这个对话之前已经结束。是否重新打开并继续？")) return;
        s.endedAt = null;
        touchSession(s);
      }
      clearReadonlyMode();
      if (!canEnterChat()) return;
      location.href = "chat.html";
    } else {
      sessionStorage.setItem("feynman_readonly", "1");
      location.href = "chat.html";
    }
  }
  function updateControls() {
    const active = backendActive();
    const closing = backendClosing();
    const readonly = isReadonlyMode();
    const s = currentSession();
    const kp = s && s.knowledgePoint ? String(s.knowledgePoint).trim() : "";
    const hasSession = !!s;
    const sessionCount = listSessions().length;
    if (els.knowledgePoint) els.knowledgePoint.disabled = false;
    if (els.learningGoal) els.learningGoal.disabled = false;
    if (els.newChatBtn) els.newChatBtn.disabled = !active;
    if (els.sendBtn) els.sendBtn.disabled = readonly || !active || sending || closing;
    if (els.retryBtn) els.retryBtn.disabled = readonly || !active || sending;
    if (els.userInput) els.userInput.disabled = readonly || !active || closing;
    if (els.continueBtn) els.continueBtn.disabled = sessionCount === 0;
    if (els.openSessionBtn) els.openSessionBtn.disabled = sessionCount === 0;
    if (els.lockHint) {
      if (readonly) {
        els.lockHint.textContent = "只读模式：正在查看历史对话。激活或加时后才能继续发送。";
        els.lockHint.className = "lock-hint danger";
      } else if (!backendReady()) {
        els.lockHint.textContent = "后端未配置：请检查 js/config.js 的 BACKEND.url。";
        els.lockHint.className = "lock-hint danger";
      } else if (!state.backendToken) {
        els.lockHint.textContent = "请先输入激活码激活。";
        els.lockHint.className = "lock-hint";
      } else if (closing) {
        els.lockHint.textContent = "时长已到：当前对话只能收尾结束。";
        els.lockHint.className = "lock-hint danger";
      } else if (!active) {
        els.lockHint.textContent = "当前没有可用时长/次数，请先激活或加时。";
        els.lockHint.className = "lock-hint danger";
      } else if (!hasSession) {
        els.lockHint.textContent = "请填写知识点并点击“开始新对话”。";
        els.lockHint.className = "lock-hint ok";
      } else {
        els.lockHint.textContent = "已就绪：用大白话讲解，Ctrl+Enter 发送。";
        els.lockHint.className = "lock-hint ok";
      }
    }
    // 设置页三步引导：没有可用时长/次数时，重置回第 1 步
    if (els.setupStep1) {
      els.setupStep1.className = "step " + ((!state.backendToken || !active) ? "active" : "done");
    }
    if (els.setupStep2) {
      if (!active) els.setupStep2.className = "step";
      else if (kp) els.setupStep2.className = "step done";
      else els.setupStep2.className = "step active";
    }
    if (els.setupStep3) {
      if (!active || !kp) els.setupStep3.className = "step";
      else if (hasSession && s.messages && s.messages.length) els.setupStep3.className = "step done";
      else els.setupStep3.className = "step active";
    }
    if (els.setupHint) {
      if (readonly) {
        els.setupHint.textContent = "当前是只读模式：可以查看历史对话，激活或加时后才能继续发送。";
      } else if (!state.backendToken) {
        els.setupHint.textContent = "第 1 步：请先输入激活码。";
      } else if (!active) {
        els.setupHint.textContent = "当前没有可用时长/次数，请在下面继续激活或加时。";
      } else if (!kp) {
        els.setupHint.textContent = "第 2 步：填写你想讲清楚的知识点。";
      } else {
        els.setupHint.textContent = "第 3 步：点击“开始新对话”，AI 学生会先向你提问。";
      }
    }
  }


  function currentSession() {
    if (!state.currentSessionId) return null;
    return state.sessions[state.currentSessionId] || null;
  }
  function ensureSession() {
    let s = currentSession();
    if (!s) {
      s = makeSession(els.knowledgePoint.value.trim(), els.learningGoal.value.trim());
      state.currentSessionId = s.id;
      state.sessions[s.id] = s;
      saveState();
    }
    return s;
  }
  function makeSession(kp, goal) {
    const now = Date.now();
    return {
      id: uid(), knowledgePoint: kp || "", learningGoal: goal || "",
      messages: [], mastery: 0, passed: false, createdAt: now, updatedAt: now, endedAt: null
    };
  }
  function touchSession(s) {
    if (!s) return;
    s.updatedAt = Date.now();
    state.sessions[s.id] = s;
    saveState();
  }
  function listSessions() {
    return Object.values(state.sessions).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  /* ---------------- 基础 UI ---------------- */
  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.add("hidden"), ms || 2600);
  }
  function showApiError(msg) {
    els.apiError.textContent = msg;
    els.apiError.classList.remove("hidden");
  }
  function clearApiError() { els.apiError.classList.add("hidden"); els.apiError.textContent = ""; }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function stripAiMarkers(text) {
    return String(text || "").replace(/\[\[MASTERY\s*:\s*\d{1,3}\]\]/ig, "").replace(/\[\[PASS\]\]/ig, "").trim();
  }
  function renderMarkdown(text) {
    const src = String(text || "");
    let html;
    if (window.marked && typeof window.marked.parse === "function") {
      html = window.marked.parse(src, { gfm: true, breaks: true });
    } else {
      html = escapeHtml(src).replace(/\n/g, "<br>");
    }
    if (window.DOMPurify) html = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    return html;
  }
  function renderMath(root) {
    if (!window.renderMathInElement) return;
    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\[", right: "\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\(", right: "\)", display: false }
        ],
        throwOnError: false
      });
    } catch (e) {}
  }
  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60), s = total % 60;
    if (d > 0) return `${d}天${h}小时${m}分`;
    if (h > 0) return `${h}小时${m}分${s}秒`;
    return `${m}分${s}秒`;
  }
  function parseAiMeta(text) {
    const src = String(text || "");
    const masteryMatches = [...src.matchAll(/\[\[MASTERY\s*:\s*(\d{1,3})\]\]/ig)];
    let mastery = masteryMatches.length ? Number(masteryMatches[masteryMatches.length - 1][1]) : null;
    if (mastery != null) mastery = Math.max(0, Math.min(100, mastery));
    const pass = /\[\[PASS\]\]/i.test(src);
    return { mastery, pass, clean: stripAiMarkers(src) };
  }

  /* ---------------- 渲染 ---------------- */
  function renderSessions() {
    if (!els.sessionSelect) return;
    const list = listSessions();
    els.sessionSelect.innerHTML = "";
    if (!list.length) {
      const o = document.createElement("option");
      o.value = ""; o.textContent = "暂无历史对话";
      els.sessionSelect.appendChild(o);
      return;
    }
    list.forEach(s => {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = (s.knowledgePoint || "未命名知识点") + (s.passed ? " ✅已通关" : "") +
        " · " + new Date(s.updatedAt || s.createdAt).toLocaleString();
      if (s.id === state.currentSessionId) o.selected = true;
      els.sessionSelect.appendChild(o);
    });
  }
  function renderMastery() {
    const s = currentSession();
    const m = s ? Number(s.mastery || 0) : 0;
    if (els.masteryBar) els.masteryBar.style.width = Math.max(0, Math.min(100, m)) + "%";
    if (els.masteryText) els.masteryText.textContent = `AI 学生掌握度：${Math.round(m)}%`;
    if (els.passBadge) els.passBadge.classList.toggle("hidden", !(s && s.passed));
    if (els.passPill) {
      els.passPill.textContent = s && s.passed ? "已通关" : "未通关";
      els.passPill.className = "pill " + (s && s.passed ? "ok" : "");
    }
  }
  function renderChat() {
    if (!els.chatMessages) return;
    const s = currentSession();
    els.chatMessages.innerHTML = "";
    if (!s || !s.messages.length) {
      els.chatMessages.innerHTML = `<div class="empty-state"><p>先在上面填写知识点，然后点击“开始新对话”。</p><p>你要做的是：把知识讲给一个需要被教会的学生听，直到它真的学会并通过考试。</p></div>`;
    } else {
      s.messages.forEach(m => appendMessage(m.role, m.content, m.meta || {}, false));
    }
    els.chatTitle.textContent = s && s.knowledgePoint ? "正在讲解：" + s.knowledgePoint : "与 AI 学生对话";
    els.chatSubtitle.textContent = s && s.passed
      ? "本次对话已通过考试。你可以继续追问，也可以开始新的知识点。"
      : "AI 会追问、犯典型错误、要求举例；你讲不清时，它绝不假装懂。";
    renderMath(els.chatMessages);
    els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }
  function appendMessage(role, content, meta, scroll) {
    if (!els.chatMessages) return;
    const wrap = document.createElement("div");
    wrap.className = "msg " + (role === "user" ? "user" : "ai");
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = role === "user" ? "我" : "AI";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const tag = document.createElement("span");
    tag.className = "role-tag";
    tag.textContent = role === "user" ? "讲解者" : (meta && meta.pass ? "AI 学生 · 已通过考试" : "AI 学生 · 等待讲解");
    bubble.appendChild(tag);
    const body = document.createElement("div");
    body.innerHTML = renderMarkdown(role === "assistant" ? stripAiMarkers(content) : content);
    bubble.appendChild(body);
    wrap.appendChild(avatar); wrap.appendChild(bubble);
    els.chatMessages.appendChild(wrap);
    renderMath(body);
    if (scroll !== false) els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
  }
  function renderTimer() {
    if (!els.timePill || !els.licensePill) return;
    const st = state.backendStatus;
    const closing = !!(st && st.closing);
    const available = !!(st && (st.available != null ? st.available : st.active) && !st.closing);
    if (closing) {
      els.timePill.textContent = "时长已到 · 请结束本次对话";
      els.timePill.className = "pill warn";
    } else if (st && st.current) {
      const c = st.current;
      if (c.type === "time") {
        if (c.status === "pending") {
          els.timePill.textContent = "待开始：进入对话后计时";
          els.timePill.className = "pill warn";
        } else {
          let ms = Number(c.remainingMs || 0);
          if (state.backendStatusAt) ms = Math.max(0, ms - (Date.now() - state.backendStatusAt));
          els.timePill.textContent = "剩余：" + formatDuration(ms);
          els.timePill.className = "pill " + (ms > 0 ? "ok" : "warn");
        }
      } else {
        els.timePill.textContent = "剩余：" + Number(c.remainingUses || 0) + " 次";
        els.timePill.className = "pill ok";
      }
    } else {
      els.timePill.textContent = "剩余：0";
      els.timePill.className = "pill bad";
    }
    els.licensePill.textContent = closing ? "待结束" : (available ? "已授权" : (state.backendToken ? "已到期" : "未激活"));
    els.licensePill.className = "pill " + (available ? "ok" : (closing ? "warn" : (state.backendToken ? "bad" : "")));
    const q = (st && st.queue) || [];
    if (els.queueInfo) {
      if (q.length > 1) {
        els.queueInfo.textContent = "当前套餐：" + (q[0].pname || q[0].pid || "套餐") +
          (q[0].status === "pending" ? "（待开始）" : "") +
          "；排队中：" + q.slice(1).map(g => (g.pname || g.pid || "套餐")).join(" → ");
      } else if (q.length === 1) {
        els.queueInfo.textContent = "当前套餐：" + (q[0].pname || q[0].pid || "套餐") +
          (q[0].status === "pending" ? "（待开始，进入对话后计时）" : "");
      } else {
        els.queueInfo.textContent = "";
      }
    }
    updateControls();
  }

  function renderAll() {
    const s = currentSession();
    if (s && els.knowledgePoint) {
      els.knowledgePoint.value = s.knowledgePoint || "";
      if (els.learningGoal) els.learningGoal.value = s.learningGoal || "";
    }
    renderSessions();
    renderMastery();
    renderChat();
    renderTimer();
  }

  /* ---------------- 授权与计时 ---------------- */
  function canUseSession(s) {
    return backendActive();
  }
  function tick() {
    const now = Date.now();
    if (backendReady() && state.backendToken && now - lastStatusRefresh > 15000) {
      lastStatusRefresh = now;
      refreshStatus(true).catch(() => {});
    }
    renderTimer();
    if (now - lastPersist > 5000) {
      lastPersist = now;
      saveState();
    }
  }
  async function activateCode() {
    const code = els.activationCode.value.trim();
    if (!backendReady()) { els.activationMsg.textContent = "❌ 后端未配置，请检查 js/config.js 的 BACKEND.url。"; return; }
    if (!code) { toast("请输入激活码。"); return; }
    els.activateBtn.disabled = true;
    els.activationMsg.textContent = "正在校验并核销...";
    try {
      const res = await B.redeem(code, getClientId());
      state.backendToken = res.token || "";
      state.backendStatus = res.status || null;
      state.backendStatusAt = Date.now();
      saveState();
      els.activationCode.value = "";
      const current = state.backendStatus && state.backendStatus.current;
      els.activationMsg.textContent = "激活成功：" + ((current && (current.pname || current.pid)) || "服务已到账") + "。";
      renderTimer();
      toast("激活/加时成功");
      closeSidebar();
      toast("激活成功。请填写知识点，点击“开始新对话”。");
    } catch (e) {
      els.activationMsg.textContent = "❌ " + (e && e.message ? e.message : "激活失败");
    } finally {
      els.activateBtn.disabled = false;
    }
  }

  /* ---------------- 与大模型交互 ---------------- */
  async function requestAi(s, isStart) {
    if (sending) return;
    if (!backendReady() || !state.backendToken) {
      els.activationMsg.textContent = "❌ 当前没有后端登录状态，请先输入激活码。";
      return;
    }
    if (!backendActive() && !isStart) {
      showApiError("当前没有可用时长/次数，请先激活或加时。");
      return;
    }
    sending = true;
    clearApiError();
    updateControls();
    els.retryBtn.classList.add("hidden");

    const history = s.messages
      .filter(m => m && (m.role === "user" || m.role === "assistant") && !(m.meta && m.meta.streaming))
      .map(m => ({ role: m.role, content: String(m.content || "") }));

    const streamMsg = { role: "assistant", content: "", meta: { streaming: true }, ts: Date.now() };
    s.messages.push(streamMsg);
    const wrap = document.createElement("div");
    wrap.className = "msg ai";
    wrap.innerHTML = '<div class="avatar">AI</div><div class="bubble"><span class="role-tag">AI 学生 · 正在回复</span><div class="stream-body"></div></div>';
    els.chatMessages.appendChild(wrap);
    const body = wrap.querySelector(".stream-body");
    const scroll = () => { els.chatMessages.scrollTop = els.chatMessages.scrollHeight; };
    scroll();

    try {
      const raw = await B.chat(state.backendToken, {
        knowledgePoint: s.knowledgePoint || "",
        learningGoal: s.learningGoal || "",
        messages: history,
        start: !!isStart
      }, (delta, full) => {
        streamMsg.content = full;
        body.innerHTML = renderMarkdown(stripAiMarkers(full));
        renderMath(body);
        scroll();
      });

      streamMsg.content = raw || streamMsg.content;
      const meta = parseAiMeta(streamMsg.content);
      streamMsg.meta = { mastery: meta.mastery, pass: meta.pass };
      if (meta.mastery != null) s.mastery = meta.mastery;
      if (meta.pass && Number(s.mastery || 0) >= Number(cfg.APP.masteryPassScore || 80)) {
        s.passed = true;
        s.mastery = 100;
        toast("🎓 AI 学生考试通过：你真的教会它了！", 4200);
      } else if (meta.pass) {
        showApiError("AI 发出了通过标记，但掌握度未达到阈值 " + cfg.APP.masteryPassScore + "%。已按未通过处理，请继续讲解或重试。");
      }
      touchSession(s);
      renderChat();
      renderMastery();
      await refreshStatus(true).catch(() => {});
    } catch (e) {
      s.messages = s.messages.filter(m => m !== streamMsg);
      renderChat();
      const msg = e && e.message ? e.message : "请求失败，请稍后重试。";
      showApiError(msg);
      if (e && e.payload && e.payload.status) {
        state.backendStatus = e.payload.status;
        state.backendStatusAt = Date.now();
        renderTimer();
      }
      if (!(e && e.payload && e.payload.error === "CURRENT_CONVERSATION_MUST_END")) {
        els.retryBtn.classList.remove("hidden");
      }
    } finally {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      sending = false;
      updateControls();
    }
  }

  async function send() {
    if (isReadonlyMode()) { toast("只读模式：激活或加时后才能继续发送。"); return; }
    const s = ensureSession();
    const text = els.userInput.value.trim();
    if (!s.knowledgePoint) { toast("请先填写知识点。"); els.knowledgePoint.focus(); return; }
    if (s.endedAt) { toast("本次对话已结束，请开始新对话。"); showSettings(); return; }
    if (!text) { toast("请输入你的讲解。"); els.userInput.focus(); return; }
    if (text.length > Number(cfg.APP.maxInputChars || 6000)) { toast("单次输入太长，请精简到 " + cfg.APP.maxInputChars + " 字以内。"); return; }
    if (!backendReady()) { toast("后端未配置，请检查 js/config.js 的 BACKEND.url。"); return; }
    if (backendClosing()) { toast("时长已到，请先点击“结束本次对话”。"); return; }
    if (!backendActive()) {
      els.activationMsg.textContent = "❌ 当前没有可用时长/次数，请先输入激活码。";
      toast("请先激活，或输入加时码。");
      return;
    }
    s.messages.push({ role: "user", content: text, ts: Date.now() });
    els.userInput.value = "";
    touchSession(s);
    renderChat();
    await requestAi(s, false);
  }

  function retryLast() {
    const s = currentSession();
    if (!s || !s.messages.length) return;
    if (s.messages[s.messages.length - 1].role !== "user") {
      toast("没有需要重试的上一条讲解。");
      return;
    }
    requestAi(s, false);
  }

  /* ---------------- OCR ---------------- */
  async function runOcr() {
    const file = els.imageInput.files && els.imageInput.files[0];
    if (!file) { toast("请先选择一张图片。"); return; }
    if (!window.Tesseract) { els.ocrStatus.textContent = "OCR 组件未加载：请检查网络/CDN 是否可访问。"; return; }
    els.ocrBtn.disabled = true;
    els.ocrStatus.textContent = "正在识别：0%";
    try {
      const result = await window.Tesseract.recognize(file, cfg.APP.ocrLang || "chi_sim+eng", {
        logger: m => {
          if (m.status === "recognizing text") els.ocrStatus.textContent = "正在识别：" + Math.round((m.progress || 0) * 100) + "%";
          else els.ocrStatus.textContent = m.status || "处理中...";
        }
      });
      els.ocrText.value = (result && result.data && result.data.text ? result.data.text : "").trim();
      els.ocrStatus.textContent = els.ocrText.value ? "识别完成，请检查并修改下方文字。" : "没有识别到文字，请换一张更清晰的图片。";
    } catch (e) {
      els.ocrStatus.textContent = "识别失败：" + (e && e.message ? e.message : e);
    } finally {
      els.ocrBtn.disabled = false;
    }
  }
  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    if (els.knowledgePoint) {
      els.knowledgePoint.addEventListener("input", updateControls);
      els.knowledgePoint.addEventListener("change", () => {
        const s = currentSession();
        if (s) { s.knowledgePoint = els.knowledgePoint.value.trim(); touchSession(s); renderSessions(); updateControls(); }
      });
    }
    if (els.learningGoal) {
      els.learningGoal.addEventListener("input", updateControls);
      els.learningGoal.addEventListener("change", () => {
        const s = currentSession();
        if (s) { s.learningGoal = els.learningGoal.value.trim(); touchSession(s); }
      });
    }
    if (els.newChatBtn) {
      els.newChatBtn.addEventListener("click", () => {
        const kp = els.knowledgePoint.value.trim();
        if (!kp) { toast("请先填写知识点。"); return; }
        const old = currentSession();
        if (old && old.messages.length && !old.passed && !confirm("当前对话尚未通关。开始新对话后，仍可从下面的记录中打开旧对话。确定继续吗？")) return;
        const s = makeSession(kp, els.learningGoal ? els.learningGoal.value.trim() : "");
        state.currentSessionId = s.id;
        state.sessions[s.id] = s;
        saveState();
        if (canEnterChat()) { clearReadonlyMode(); location.href = "chat.html"; }
        else { renderAll(); toast("请先激活后再开始对话。"); }
      });
    }
    if (els.continueBtn) {
      els.continueBtn.addEventListener("click", () => {
        const list = listSessions();
        if (!list.length) { toast("还没有历史对话。"); return; }
        openSessionAction(list[0]);
      });
    }
    if (els.openSessionBtn) {
      els.openSessionBtn.addEventListener("click", () => {
        const id = els.sessionSelect.value;
        if (!id || !state.sessions[id]) { toast("请选择一条对话。"); return; }
        openSessionAction(state.sessions[id]);
      });
    }
    if (els.activateBtn) els.activateBtn.addEventListener("click", activateCode);
    if (els.sendBtn) els.sendBtn.addEventListener("click", send);
    if (els.retryBtn) els.retryBtn.addEventListener("click", retryLast);
    if (els.userInput) {
      els.userInput.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); send(); }
      });
    }
    if (els.backSettingsBtn) els.backSettingsBtn.addEventListener("click", showSettings);
    if (els.endSessionBtn) {
      els.endSessionBtn.addEventListener("click", async () => {
        const s = currentSession();
        if (!s) return;
        if (isReadonlyMode()) { clearReadonlyMode(); location.href = "index.html"; return; }
        if (s.messages.length && !confirm("结束本次对话？结束后如果服务已到期，将不能继续发送。")) return;
        s.endedAt = Date.now();
        if (backendReady() && state.backendToken) {
          try {
            const res = await B.end(state.backendToken);
            state.backendStatus = res.status || state.backendStatus;
            state.backendStatusAt = Date.now();
          } catch (e) {
            toast(e && e.message ? e.message : "结束后端状态失败");
          }
        }
        touchSession(s);
        location.href = "index.html";
      });
    }
    if (els.ocrBtn) els.ocrBtn.addEventListener("click", runOcr);
    if (els.insertOcrBtn) {
      els.insertOcrBtn.addEventListener("click", () => {
        const t = els.ocrText.value.trim();
        if (!t) { toast("识别内容为空。"); return; }
        if (els.userInput) {
          els.userInput.value = (els.userInput.value.trim() ? els.userInput.value.trim() + "\n\n" : "") + t;
          els.userInput.focus();
        } else if (els.knowledgePoint) {
          els.knowledgePoint.value = (els.knowledgePoint.value.trim() ? els.knowledgePoint.value.trim() + "\n\n" : "") + t;
          els.knowledgePoint.focus();
          toast("已填入知识点输入框，可继续编辑。");
        }
      });
    }
    window.addEventListener("beforeunload", saveState);
  }

  function init() {
    bind();
    if (PAGE === "chat") {
      const s = currentSession();
      if (!s) { location.replace("index.html"); return; }
      if (isReadonlyMode()) {
        renderAll();
        updateControls();
        document.body.classList.add("readonly-mode");
        tick();
        setInterval(tick, 1000);
        return;
      }
      if (!canEnterChat()) { location.replace("index.html"); return; }
      clearReadonlyMode();
      renderAll();
      updateControls();
      if (backendReady() && state.backendToken) {
        startChatSession().catch(() => {});
      }
      tick();
      setInterval(tick, 1000);
      return;
    }
    if (!state.currentSessionId) {
      const list = listSessions();
      if (list.length) state.currentSessionId = list[0].id;
    }
    renderAll();
    updateControls();
    if (backendReady() && state.backendToken) refreshStatus(true).catch(() => {});
    tick();
    setInterval(tick, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
