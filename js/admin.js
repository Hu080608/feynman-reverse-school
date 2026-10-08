(function () {
  const cfg = window.APP_CONFIG;
  const base = ((cfg.BACKEND && cfg.BACKEND.url) || "").replace(/\/+$/, "");
  const $ = id => document.getElementById(id);
  let token = localStorage.getItem("feynman_admin_token") || "";
  let cache = { redemptions: [], usage: [], logs: [], feedback: [] };
  const PAGE = 100;
  let offsets = { redemptions: 0, usage: 0, logs: 0, feedback: 0 };
  let hasMore = { redemptions: false, usage: false, logs: false, feedback: false };

  function setStatus(text, kind) {
    const el = $("adminStatus");
    el.textContent = text;
    el.className = "pill " + (kind || "");
  }
  function msg(text, ok) {
    const el = $("adminMsg");
    el.textContent = text || "";
    el.style.color = ok ? "#9ef0b5" : "#fca5a5";
  }
  async function api(path) {
    const res = await fetch(base + path, { headers: { "x-admin-token": token } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || ("请求失败 " + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function apiPost(path, payload) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(payload || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || ("请求失败 " + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }
  function fmtTime(ts) {
    if (!ts) return "-";
    return new Date(Number(ts)).toLocaleString();
  }
  function money(v) { return "¥" + Number(v || 0).toFixed(4); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function tds(cells) { return "<tr>" + cells.map(c => "<td>" + esc(c) + "</td>").join("") + "</tr>"; }

  async function login() {
    const input = $("adminToken").value.trim();
    if (!input) { msg("请输入管理员口令"); return; }
    try {
      const res = await fetch(base + "/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: input })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || "口令错误");
      token = input;
      localStorage.setItem("feynman_admin_token", token);
      setStatus("已登录", "ok");
      msg("登录成功", true);
      await refresh();
    } catch (e) {
      token = "";
      localStorage.removeItem("feynman_admin_token");
      setStatus("未登录", "bad");
      msg(e.message || "登录失败", false);
    }
  }

  async function refresh() {
    if (!token) { msg("请先输入管理员口令"); return; }
    try {
      offsets = { redemptions: 0, usage: 0, logs: 0, feedback: 0 };
      const feedbackQuery = buildFeedbackQuery(0);
      const [stats, reds, usage, logs, feedback] = await Promise.all([
        api("/api/admin/stats"),
        api("/api/admin/redemptions?limit=" + PAGE + "&offset=0"),
        api("/api/admin/usage?limit=" + PAGE + "&offset=0"),
        api("/api/admin/logs?limit=" + PAGE + "&offset=0"),
        api("/api/admin/feedback?" + feedbackQuery)
      ]);
      const s = stats.stats || {};
      $("statRedemptions").textContent = s.totalRedemptions || 0;
      $("statSessions").textContent = s.activeSessions || 0;
      $("statTokens").textContent = s.totalTokens || 0;
      $("statCost").textContent = money(s.totalCost || 0);
      $("statLogs").textContent = s.totalLogs || 0;
      cache.redemptions = reds.items || [];
      cache.usage = usage.items || [];
      cache.logs = logs.items || [];
      cache.feedback = feedback.items || [];
      hasMore.redemptions = !!reds.hasMore;
      hasMore.usage = !!usage.hasMore;
      hasMore.logs = !!logs.hasMore;
      hasMore.feedback = !!feedback.hasMore;
      renderTables();
      updateLoadMoreButtons();
      setStatus("已登录", "ok");
      msg("数据已刷新", true);
    } catch (e) {
      setStatus("登录失效", "bad");
      msg(e.message || "刷新失败", false);
    }
  }

  function buildFeedbackQuery(offset) {
    const status = $("feedbackStatusFilter") ? $("feedbackStatusFilter").value : "";
    const sort = $("feedbackSort") ? $("feedbackSort").value : "newest";
    return "limit=" + PAGE + "&offset=" + (offset || 0) + "&status=" + encodeURIComponent(status) + "&sort=" + encodeURIComponent(sort);
  }

  async function refreshFeedback() {
    if (!token) return;
    try {
      const data = await api("/api/admin/feedback?" + buildFeedbackQuery(0));
      cache.feedback = data.items || [];
      offsets.feedback = 0;
      hasMore.feedback = !!data.hasMore;
      renderTables();
      updateLoadMoreButtons();
      msg("反馈已刷新", true);
    } catch (e) {
      msg(e.message || "反馈刷新失败", false);
    }
  }

  async function loadMore(kind, path, cacheKey) {
    if (!token || !hasMore[kind]) return;
    try {
      const query = kind === "feedback" ? buildFeedbackQuery(offsets[kind]) : ("limit=" + PAGE + "&offset=" + offsets[kind]);
      const data = await api(path + "?" + query);
      cache[cacheKey] = (cache[cacheKey] || []).concat(data.items || []);
      offsets[kind] = data.nextOffset || (offsets[kind] + (data.items || []).length);
      hasMore[kind] = !!data.hasMore;
      renderTables();
      updateLoadMoreButtons();
      msg("已加载更多", true);
    } catch (e) {
      msg(e.message || "加载失败", false);
    }
  }

  function updateLoadMoreButtons() {
    [["loadMoreRedemptions", "redemptions"], ["loadMoreUsage", "usage"], ["loadMoreLogs", "logs"], ["loadMoreFeedback", "feedback"]].forEach(([id, key]) => {
      const btn = $(id);
      if (btn) btn.classList.toggle("hidden", !hasMore[key]);
    });
  }

  function renderTables() {
    $("redemptionTable").querySelector("tbody").innerHTML = cache.redemptions.map(r => tds([
      fmtTime(r.createdAt), r.pname || r.pid || "-", r.type === "time" ? "时长" : "次数",
      r.type === "time" ? (r.durationSeconds + "秒") : (r.uses + "次"),
      r.clientId || "-"
    ])).join("") || '<tr><td colspan="5">暂无记录</td></tr>';
    $("usageTable").querySelector("tbody").innerHTML = cache.usage.map(u => {
      const source = u.source === "vision" ? "识图" : (u.source === "ocr_clean" ? "OCR整理" : "对话");
      return tds([fmtTime(u.createdAt), source, u.knowledgePoint || "-", u.promptTokens || 0,
        u.completionTokens || 0, u.totalTokens || 0, money(u.cost || 0)]);
    }).join("") || '<tr><td colspan="7">暂无记录</td></tr>';
    $("logTable").querySelector("tbody").innerHTML = cache.logs.map(l => tds([
      fmtTime(l.createdAt), l.level || "info", l.event || "-", l.message || ""
    ])).join("") || '<tr><td colspan="4">暂无记录</td></tr>';
    const feedbackRows = cache.feedback.map(f => {
      const src = f.source === "chat" ? "对话页" : "设置页";
      const image = f.image ? '<button type="button" class="btn small view-feedback-image" data-id="' + esc(f.id) + '">查看图片</button>' : "-";
      const options = [
        ["unread", "未读"], ["solved", "已解决"], ["read_unsolved", "已读未解决"], ["invalid", "无效反馈"]
      ].map(pair => '<option value="' + pair[0] + '"' + (f.status === pair[0] ? " selected" : "") + ">" + pair[1] + "</option>").join("");
      const select = '<select class="status-select status-' + esc(f.status || "unread") + '" data-id="' + esc(f.id) + '">' + options + "</select>";
      return "<tr>" +
        "<td>" + esc(fmtTime(f.createdAt)) + "</td>" +
        "<td>" + esc(src) + "</td>" +
        "<td><span class='feedback-content'>" + esc(f.content || "") + "</span></td>" +
        "<td>" + esc(f.contact || "-") + "</td>" +
        "<td>" + image + "</td>" +
        "<td>" + select + "</td>" +
        "</tr>";
    }).join("");
    $("feedbackTable").querySelector("tbody").innerHTML = feedbackRows || '<tr><td colspan="6">暂无反馈</td></tr>';
  }

  function exportCsv(name, rows, headers) {
    const lines = [headers.join(",")];
    rows.forEach(r => lines.push(headers.map(h => '"' + String(r[h] == null ? "" : r[h]).replace(/"/g, '""') + '"').join(",")));
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function bind() {
    $("adminLoginBtn").addEventListener("click", login);
    $("adminRefreshBtn").addEventListener("click", refresh);
    $("adminToken").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
    $("exportRedemptions").addEventListener("click", () => exportCsv("redemptions", cache.redemptions, ["createdAt", "pname", "pid", "type", "durationSeconds", "uses", "clientId"]));
    $("exportUsage").addEventListener("click", () => exportCsv("usage", cache.usage, ["createdAt", "source", "knowledgePoint", "promptTokens", "completionTokens", "totalTokens", "cost"]));
    $("exportLogs").addEventListener("click", () => exportCsv("logs", cache.logs, ["createdAt", "level", "event", "message"]));
    $("loadMoreRedemptions").addEventListener("click", () => loadMore("redemptions", "/api/admin/redemptions", "redemptions"));
    $("loadMoreUsage").addEventListener("click", () => loadMore("usage", "/api/admin/usage", "usage"));
    $("loadMoreLogs").addEventListener("click", () => loadMore("logs", "/api/admin/logs", "logs"));
    $("feedbackRefresh").addEventListener("click", refreshFeedback);
    $("feedbackStatusFilter").addEventListener("change", refreshFeedback);
    $("feedbackSort").addEventListener("change", refreshFeedback);
    $("loadMoreFeedback").addEventListener("click", () => loadMore("feedback", "/api/admin/feedback", "feedback"));
    $("exportFeedback").addEventListener("click", () => exportCsv("feedback", cache.feedback, ["createdAt", "source", "content", "contact", "status"]));
    $("feedbackTable").addEventListener("click", (e) => {
      const btn = e.target.closest(".view-feedback-image");
      if (!btn) return;
      const item = cache.feedback.find(x => x.id === btn.getAttribute("data-id"));
      if (item && item.image) window.open(item.image, "_blank");
    });
    $("feedbackTable").addEventListener("change", async (e) => {
      const select = e.target.closest("select[data-id]");
      if (!select) return;
      const id = select.getAttribute("data-id");
      const status = select.value;
      try {
        const data = await apiPost("/api/admin/feedback/status", { id: id, status: status });
        const item = cache.feedback.find(x => x.id === id);
        if (item) {
          item.status = status;
          if (data.item && data.item.updatedAt) item.updatedAt = data.item.updatedAt;
        }
        Array.from(select.classList).filter(c => c.indexOf("status-") === 0).forEach(c => select.classList.remove(c));
        select.classList.add("status-" + status);
        msg("状态已更新", true);
      } catch (err) {
        msg(err.message || "状态更新失败", false);
        renderTables();
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})();
