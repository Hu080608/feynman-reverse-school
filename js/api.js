/* OpenAI 兼容接口封装（旧版直连备用）。 */
(function () {
  const cfg = window.APP_CONFIG;

  function buildSystemPrompt(session) {
    const kp = (session && session.knowledgePoint) || "（用户尚未填写知识点）";
    const goal = (session && session.learningGoal) || "（用户未填写具体目标）";
    return `你是“费曼反向学校”里的 AI 学生，而不是老师。用户是讲解者，你的任务是表现出一个需要被教会、会暴露盲点的学生，直到你真正学会。

【当前知识点】${kp}
【用户学习目标】${goal}

【你必须遵守的行为】
1. 先简短回应，再主动追问一个暴露理解盲点的问题。每次回复最多只问一个问题，不要连续抛出多个问题；等用户回答后再问下一个。
2. 故意犯一个符合该知识点的典型错误（混淆概念、用错公式、举反例、只记结论等），让用户纠正你。
3. 至少一次明确要求用户举例子，或用自己的话重新解释。
4. 如果用户讲解含糊、跳跃、自相矛盾、缺少步骤、回避追问，你必须直接说“我还没懂，因为……”，绝对不能顺着说“懂了”“明白了”。没懂就要继续问。
5. 不要长篇讲课，不要替用户总结全部知识；你是一个有好奇心、会犯错、需要被教会的人。
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

  async function chat(session, history) {
    const api = cfg.API || {};
    if (!api.apiKey) throw new Error("未配置 API.apiKey。");
    if (!api.baseUrl) throw new Error("未配置 API.baseUrl（服务商接口地址）。");
    if (!api.model) throw new Error("未配置 API.model（模型名）。");

    const max = Number(cfg.APP.maxHistoryMessages || 36);
    const cleaned = (history || [])
      .filter(m => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
      .slice(-max)
      .map(m => ({ role: m.role, content: String(m.content) }));

    const body = {
      model: api.model,
      messages: [{ role: "system", content: buildSystemPrompt(session) }].concat(cleaned),
      temperature: Number(api.temperature != null ? api.temperature : 0.85),
      max_tokens: Number(api.maxTokens || 900),
      stream: false
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(api.timeoutMs || 90000));
    let res;
    try {
      res = await fetch(joinUrl(api.baseUrl, "chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + api.apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") throw new Error("请求超时：模型响应太慢，请稍后重试或换用更快的模型。");
      throw new Error("网络或 CORS 错误：浏览器无法直连该 API。请确认接口支持浏览器跨域，或改用你自建的转发服务。原始信息：" + (e && e.message ? e.message : e));
    }
    clearTimeout(timer);

    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* 保留原始文本用于报错 */ }
    if (!res.ok) {
      const msg = data && data.error && data.error.message ? data.error.message : (text || res.statusText);
      if (res.status === 401) throw new Error("API Key 无效或已过期（401）：" + msg);
      if (res.status === 403) throw new Error("API 拒绝访问（403）：" + msg);
      if (res.status === 429) throw new Error("请求太频繁或额度不足（429）：" + msg);
      throw new Error("API 请求失败（" + res.status + "）：" + msg);
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : "";
    if (!content) throw new Error("API 返回内容为空，请检查模型名或接口兼容性。");
    return String(content);
  }

  window.FeynmanAPI = { chat, buildSystemPrompt };
})();
