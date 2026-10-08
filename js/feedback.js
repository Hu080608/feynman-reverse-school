(function () {
  const cfg = window.APP_CONFIG || {};
  const B = window.FeynmanBackend;
  const $ = id => document.getElementById(id);
  const from = new URLSearchParams(location.search).get("from") === "chat" ? "chat" : "settings";
  const returnUrl = from === "chat" ? "chat.html" : "index.html";
  const storageKey = (cfg.APP && cfg.APP.storageKey) || "feynman_reverse_school_v1";

  function toast(text) {
    const el = $("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  function readToken() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return "";
      const obj = JSON.parse(raw);
      return typeof obj.backendToken === "string" ? obj.backendToken : "";
    } catch (e) {
      return "";
    }
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) { resolve(""); return; }
      if (!/^image\//.test(file.type)) { reject(new Error("请选择图片文件。")); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("读取图片失败。"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("图片加载失败。"));
        img.onload = () => {
          const max = 1280;
          let w = img.width, h = img.height;
          if (w > max || h > max) {
            const scale = Math.min(max / w, max / h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  function bind() {
    const backTop = $("feedbackBackTop");
    if (backTop) backTop.href = returnUrl;

    const content = $("feedbackContent");
    const count = $("feedbackCount");
    if (content && count) {
      content.addEventListener("input", () => { count.textContent = String(content.value.length); });
      count.textContent = String(content.value.length);
    }

    const imageInput = $("feedbackImage");
    const preview = $("feedbackPreview");
    const previewImg = $("feedbackPreviewImg");
    let imageData = "";
    if (imageInput) {
      imageInput.addEventListener("change", async () => {
        const file = imageInput.files && imageInput.files[0];
        if (!file) { imageData = ""; if (preview) preview.classList.add("hidden"); return; }
        try {
          imageData = await compressImage(file);
          if (previewImg) previewImg.src = imageData;
          if (preview) preview.classList.remove("hidden");
        } catch (e) {
          imageData = ""; if (preview) preview.classList.add("hidden");
          toast(e.message || "图片处理失败");
        }
      });
    }
    const clearImage = $("clearImageBtn");
    if (clearImage) clearImage.addEventListener("click", () => {
      imageData = "";
      if (imageInput) imageInput.value = "";
      if (preview) preview.classList.add("hidden");
    });

    const form = $("feedbackForm");
    const btn = $("feedbackSubmitBtn");
    const msg = $("feedbackMsg");
    if (!form || !btn) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = String(content && content.value || "").trim();
      if (!text) { msg.textContent = "请先填写反馈内容。"; return; }
      if (text.length > 1000) { msg.textContent = "反馈内容不能超过 1000 字。"; return; }
      btn.disabled = true;
      msg.textContent = "正在提交...";
      try {
        const res = await B.feedback({
          token: readToken(),
          content: text,
          contact: String($("feedbackContact") && $("feedbackContact").value || "").trim(),
          image: imageData,
          source: from
        });
        if (!res || !res.ok) throw new Error((res && res.message) || "提交失败");
        msg.textContent = "提交成功，感谢你的反馈！正在返回...";
        toast("反馈提交成功");
        setTimeout(() => { location.href = returnUrl; }, 1600);
      } catch (err) {
        msg.textContent = "提交失败：" + (err && err.message ? err.message : err);
        btn.disabled = false;
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
