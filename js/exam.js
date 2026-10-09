(function () {
  const cfg = window.APP_CONFIG || {};
  const B = window.FeynmanBackend;
  const $ = id => document.getElementById(id);
  const stateKey = (cfg.APP && cfg.APP.storageKey) || "feynman_reverse_school_v1";

  function toast(text) {
    const el = $("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.add("hidden"), 2600);
  }
  function getAppState() {
    try { return JSON.parse(localStorage.getItem(stateKey) || "{}"); } catch (e) { return {}; }
  }
  function getCurrentSession(st) {
    if (!st || !st.currentSessionId || !st.sessions) return null;
    return st.sessions[st.currentSessionId] || null;
  }
  function msg(text, ok) {
    const el = $("examMsg");
    if (el) { el.textContent = text || ""; el.style.color = ok ? "#9ef0b5" : "#fca5a5"; }
  }

  function bind() {
    if (!localStorage.getItem("feynman_user_session")) {
      location.replace("account.html?force=1&return=chat&v=48");
      return;
    }
    const st = getAppState();
    const s = getCurrentSession(st);
    const kp = s && s.knowledgePoint ? s.knowledgePoint : "";
    $("examKnowledge").value = kp || "";
    $("skipExamBtn").addEventListener("click", () => { location.href = "chat.html?v=48"; });
    $("examForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!st.backendToken) { msg("请先进入对话页，获取学习额度后再参加考核。"); return; }
      const answers = [$("answer1").value.trim(), $("answer2").value.trim(), $("answer3").value.trim()];
      if (!answers[0] || !answers[1] || !answers[2]) { msg("三道题都答一下再提交。"); return; }
      const btn = $("submitExamBtn");
      btn.disabled = true;
      msg("AI 考官正在评分...");
      try {
        const res = await B.examGrade(st.backendToken, kp, answers);
        if (!res || !res.ok) throw new Error((res && res.message) || "评分失败");
        const result = $("examResult");
        result.classList.remove("hidden", "pass", "fail");
        result.classList.add(res.pass ? "pass" : "fail");
        result.innerHTML = '<div class="exam-score">' + res.score + ' 分</div><div>' + escapeHtml(res.comment || "") + "</div>" +
          '<p class="tiny">' + (res.pass ? "考核通过，可以继续新知识点。" : "还没到 80 分，可以回去继续讲给 AI 学生听。") + "</p>";
        msg(res.pass ? "考核通过" : "继续加油", res.pass);
        toast(res.pass ? "考核通过" : "评分完成");
      } catch (err) {
        msg(err.message || "评分失败");
      } finally {
        btn.disabled = false;
      }
    });
  }
  function escapeHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
