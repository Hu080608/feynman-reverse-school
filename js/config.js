/* =========================================================================
 * 集中配置：所有密钥、API、授权参数都只在这里改，不要散落到业务代码中。
 * 安全提醒：纯静态网页中的 API Key、HMAC 密钥、任何“前端密码”都不可能真正保密。
 * 生产环境务必使用自己的受限代理 / 云函数 / Cloudflare Worker 转发大模型请求。
 * ========================================================================= */
window.APP_CONFIG = {
  // 产品信息：制作者与版本号（后续迭代只需改这里）
  APP_INFO: { author: "胡胜杰", version: "v1.3.4" },
  // 后端地址：开发时指向本地 wrangler dev；正式部署后改成你的公网后端地址。
  BACKEND: {
    url: "https://api.feynman-hsj.top"
  },

  // 以下 API 配置仅用于旧版直连模式，当前前端默认走后端，不再使用前端 API Key。
  API: {
    baseUrl: "",
    model: "",
    apiKey: "",
    temperature: 0.85,
    maxTokens: 900,
    timeoutMs: 90000
  },

  AUTH: {
    // ecdsa：推荐。前端只放公钥，用私钥离线签发，用户无法从网页伪造。
    // hmac：仅本地演示，密钥会进浏览器，用户可自行伪造，绝不可用于正式售卖。
    mode: "ecdsa",
    // 把 tools/keygen.mjs 生成的 publicJwk 粘贴到这里。
    publicKeyJwk: {
        "crv": "P-256",
        "kty": "EC",
        "x": "wIBH_i1kFv-oXd7hEbkwstVkcC2RnEFlu347kV2oKXY",
        "y": "DALV-GxcgeUqpln1b_3EMTau3LFwLtt3x7oM0_zmWj8"
    },
    // 仅当 mode === "hmac" 时使用；务必不要用于正式环境。
    hmacSecret: "",
    // 本地时钟回拨容差：超过这个值判定为异常并锁定新对话。
    clockRollbackToleranceMs: 120000,
    // 是否在检测到明显时钟回拨时锁定新使用（已有的“完成本次对话”宽限仍可用）。
    lockOnClockRollback: true
  },

  APP: {
    storageKey: "feynman_reverse_school_v1",
    masteryPassScore: 80,
    maxHistoryMessages: 36,       // 传给大模型的历史消息上限，防止 token 爆炸
    maxInputChars: 6000,
    finishCurrentConversationOnExpiry: true, // 时长到点但对话未结束时，允许完成本次对话
    ocrLang: "chi_sim+eng",
    // 次数套餐的扣减单位：turn = 用户每发送一次讲解扣 1 次；session = 每完成一个知识点扣 1 次
    countUnit: "turn"
  },

  // 仅用于生成脚本 / 展示，实际签发时以命令行参数为准。请按你公众号的商品修改。
  PRODUCT_PRESETS: [
    { id: "trial_1h", name: "体验装·1小时", type: "time", durationSeconds: 3600, validDays: 7 },
    { id: "day_1d",  name: "标准装·1天",   type: "time", durationSeconds: 86400, validDays: 30 },
    { id: "month_30d", name: "月度装·30天", type: "time", durationSeconds: 2592000, validDays: 60 },
    { id: "count_20", name: "次数装·20次", type: "count", uses: 20, validDays: 60 }
  ]
};
