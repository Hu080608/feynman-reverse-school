(function () {
  const cfg = window.APP_CONFIG;
  const base = ((cfg.BACKEND && cfg.BACKEND.url) || "").replace(/\/+$/, "");
  const $ = id => document.getElementById(id);
  let token = localStorage.getItem("feynman_admin_token") || "";
  let cache = { redemptions: [], usage: [], logs: [] };
  const PAGE = 100;
  let offsets = { redemptions: 0, usage: 0, logs: 0 };
  let hasMore = { redemptions: false, usage: false, logs: false };

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
      offsets = { redemptions: 0, usage: 0, logs: 0 };
      const [stats, reds, usage, logs] = await Promise.all([
        api("/api/admin/stats"),
        api("/api/admin/redemptions?limit=" + PAGE + "&offset=0"),
        api("/api/admin/usage?limit=" + PAGE + "&offset=0"),
        api("/api/admin/logs?limit=" + PAGE + "&offset=0")
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
      hasMore.redemptions = !!reds.hasMore;
      hasMore.usage = !!usage.hasMore;
      hasMore.logs = !!logs.hasMore;
      renderTables();
      updateLoadMoreButtons();
      setStatus("已登录", "ok");
      msg("数据已刷新", true);
    } catch (e) {
      setStatus("登录失效", "bad");
      msg(e.message || "刷新失败", false);
    }
  }

  async function loadMore(kind, path, cacheKey) {
    if (!token || !hasMore[kind]) return;
    try {
      const data = await api(path + "?limit=" + PAGE + "&offset=" + offsets[kind]);
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
    [["loadMoreRedemptions", "redemptions"], ["loadMoreUsage", "usage"], ["loadMoreLogs", "logs"]].forEach(([id, key]) => {
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
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})();
