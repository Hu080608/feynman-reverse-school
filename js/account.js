(function () {
  const B = window.FeynmanBackend;
  const cfg = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);
  const TOKEN_KEY = "feynman_user_session";
  let currentUser = null;
  const params = new URLSearchParams(location.search);
  const force = params.get("force") === "1";
  const returnPage = params.get("return") || "settings";
  const targetUrl = returnPage === "chat" ? "chat.html?v=51" : "index.html?v=51";

  function toast(text) {
    const el = $("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.add("hidden"), 2600);
  }
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
  function msg(id, text, ok) {
    const el = $(id);
    if (el) { el.textContent = text || ""; el.style.color = ok ? "#9ef0b5" : "#fca5a5"; }
  }

  function syncLicenseToApp(res) {
    if (!res) return;
    const key = (cfg.APP && cfg.APP.storageKey) || "feynman_reverse_school_v1";
    try {
      const raw = localStorage.getItem(key);
      const st = raw ? JSON.parse(raw) : {};
      if (res.licenseToken) {
        st.backendToken = res.licenseToken;
        st.backendStatus = res.licenseStatus || null;
        st.backendStatusAt = Date.now();
        localStorage.setItem(key, JSON.stringify(st));
      }
    } catch (e) {}
  }

  function showAuth(showRegister) {
    $("authView").classList.remove("hidden");
    $("profileView").classList.add("hidden");
    $("tabLogin").classList.toggle("active", !showRegister);
    $("tabRegister").classList.toggle("active", !!showRegister);
    $("loginForm").classList.toggle("hidden", !!showRegister);
    $("registerForm").classList.toggle("hidden", !showRegister);
  }

  function goBackIfNeeded() {
    if (currentUser && !currentUser.profileCompleted) return;
    if (!force && !params.get("return")) return;
    setTimeout(() => { location.href = targetUrl; }, 900);
  }

  function renderProfile(user) {
    currentUser = user;
    try { localStorage.setItem("feynman_user_profile", JSON.stringify(user)); } catch (e) {}
    const notice = $("forceNotice");
    if (notice) notice.classList.toggle("hidden", !force);
    const profileNotice = $("profileNotice");
    if (profileNotice) profileNotice.classList.toggle("hidden", !!user.profileCompleted);
    $("authView").classList.add("hidden");
    $("profileView").classList.remove("hidden");
    $("profileTitle").textContent = (user.nickname || user.username || "我的资料") + " 的资料";
    $("profileSubtitle").textContent = "用户名：" + (user.username || "");
    $("profileTags").innerHTML = (user.profileTags || []).map(t => '<span class="profile-tag">' + escapeHtml(t) + "</span>").join("") || '<span class="profile-tag">还没有画像标签</span>';
    $("pNickname").value = user.nickname || "";
    $("pGender").value = user.gender || "";
    $("pStage").value = user.schoolStage || "";
    $("pGrade").value = user.grade || "";
    $("pGoal").value = user.goal || "学会并能讲清楚";
    $("pBio").value = user.bio || "";
  }

  function escapeHtml(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function loadMe() {
    const token = getToken();
    if (!token) { showAuth(false); return; }
    try {
      const res = await B.userMe(token);
      if (!res || !res.ok) throw new Error((res && res.message) || "登录状态失效");
      if (getToken() !== token) return;
      renderProfile(res.user);
      syncLicenseToApp(res);
      goBackIfNeeded();
    } catch (e) {
      if (getToken() === token) {
        setToken("");
        showAuth(false);
      }
    }
  }

  function bindPasswordEyes() {
    Array.from(document.querySelectorAll("[data-eye]")).forEach(btn => {
      btn.addEventListener("click", () => {
        const input = document.getElementById(btn.getAttribute("data-eye"));
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.textContent = show ? "🙈" : "👁";
        btn.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
      });
    });
  }

  function bind() {
    bindPasswordEyes();
    $("tabLogin").addEventListener("click", () => showAuth(false));
    $("tabRegister").addEventListener("click", () => showAuth(true));

    $("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!B || typeof B.userLogin !== "function") { msg("loginMsg", "账号服务未加载，请刷新页面后重试。"); return; }
      const username = $("loginUsername").value.trim();
      const password = $("loginPassword").value;
      if (!username || !password) { msg("loginMsg", "请输入用户名和密码。"); return; }
      msg("loginMsg", "正在登录...");
      try {
        const res = await B.userLogin(username, password);
        if (!res || !res.ok) throw new Error((res && res.message) || "登录失败");
        setToken(res.token);
        renderProfile(res.user);
        syncLicenseToApp(res);
        toast(res.licenseToken ? "登录成功，学习额度已同步" : "登录成功");
        if (res.user && res.user.profileCompleted) goBackIfNeeded();
      } catch (err) {
        msg("loginMsg", err.message || "登录失败");
      }
    });

    $("registerForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!B || typeof B.userRegister !== "function") { msg("registerMsg", "账号服务未加载，请刷新页面后重试。"); return; }
      const username = $("regUsername").value.trim();
      const password = $("regPassword").value;
      const confirm = $("regConfirm").value;
      if (!username || !password || !confirm) { msg("registerMsg", "请填写完整。"); return; }
      msg("registerMsg", "正在检查用户名...");
      try {
        const check = await B.userCheckName(username);
        if (check && check.ok === false) throw new Error(check.message || "用户名不可用");
        if (check && check.available === false) { msg("registerMsg", "用户名已存在，请换一个。"); return; }
        msg("registerMsg", "正在注册...");
        const res = await B.userRegister(username, password, confirm);
        if (!res || !res.ok) throw new Error((res && res.message) || "注册失败");
        setToken(res.token);
        renderProfile(res.user);
        syncLicenseToApp(res);
        toast("注册成功，请先完善资料");
        if (res.user && res.user.profileCompleted) goBackIfNeeded();
      } catch (err) {
        msg("registerMsg", err.message || "注册失败");
      }
    });

    $("profileForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = getToken();
      if (!token) { showAuth(false); return; }
      const stage = $("pStage").value;
      if (!stage) {
        msg("profileMsg", "请先选择学段。");
        return;
      }
      msg("profileMsg", "正在保存...");
      try {
        const res = await B.userProfile(token, {
          nickname: $("pNickname").value.trim(),
          gender: $("pGender").value,
          schoolStage: $("pStage").value,
          grade: $("pGrade").value.trim(),
          goal: $("pGoal").value.trim(),
          bio: $("pBio").value.trim()
        });
        if (!res || !res.ok) throw new Error((res && res.message) || "保存失败");
        renderProfile(res.user);
        msg("profileMsg", res.user.profileCompleted ? "资料已保存。" : "资料已保存，但还缺少必填项，请继续完善。", !!res.user.profileCompleted);
        toast("资料已保存");
        if (res.user.profileCompleted) goBackIfNeeded();
      } catch (err) {
        msg("profileMsg", err.message || "保存失败");
      }
    });

    $("passwordForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = getToken();
      if (!token) { showAuth(false); return; }
      msg("passwordMsg", "正在修改...");
      try {
        const res = await B.userPassword(token, $("oldPassword").value, $("newPassword").value, $("newConfirm").value);
        if (!res || !res.ok) throw new Error((res && res.message) || "修改失败");
        setToken(res.token);
        $("oldPassword").value = ""; $("newPassword").value = ""; $("newConfirm").value = "";
        msg("passwordMsg", "密码已修改，其他设备需要重新登录。", true);
        toast("密码已修改");
      } catch (err) {
        msg("passwordMsg", err.message || "修改失败");
      }
    });

    $("logoutBtn").addEventListener("click", async () => {
      const token = getToken();
      if (token) { try { await B.userLogout(token); } catch (e) {} }
      setToken("");
      currentUser = null;
      showAuth(false);
      toast("已退出登录");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { bind(); loadMe(); });
  else { bind(); loadMe(); }
})();
