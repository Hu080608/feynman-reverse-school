# -*- coding: utf-8 -*-
"""生成费曼反向学校品牌资产：纯图形图标 + 宣传图。"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
TOOL_ASSETS = os.path.join(ROOT, "tools", "assets")
DOCS = os.path.join(ROOT, "docs")
os.makedirs(ASSETS, exist_ok=True)
os.makedirs(TOOL_ASSETS, exist_ok=True)
os.makedirs(DOCS, exist_ok=True)

CYAN = (34, 211, 238)
PURPLE = (109, 140, 255)
DARK = (7, 11, 22)
PANEL = (15, 24, 44)
TEXT = (238, 244, 255)
MUTED = (147, 166, 207)
GREEN = (34, 197, 94)
WARN = (245, 158, 11)
NAVY = (15, 30, 62)


def make_icon_svg():
    return '''<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="iconBg" x1="40" y1="24" x2="472" y2="488" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6D8CFF"/>
      <stop offset="1" stop-color="#22D3EE"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="126" fill="url(#iconBg)"/>
  <path d="M132 98h248c34 0 62 28 62 62v144c0 34-28 62-62 62H266l-78 68v-68h-56c-34 0-62-28-62-62V160c0-34 28-62 62-62z" fill="#FFFFFF"/>
  <path d="M198 194a66 66 0 1 1 20 100" stroke="#15264F" stroke-width="26" stroke-linecap="round" fill="none"/>
  <path d="M206 300l-42 8 26 38 16-46z" fill="#15264F"/>
  <circle cx="318" cy="210" r="18" fill="#6D8CFF"/>
</svg>'''


def draw_icon_png(size=512):
    scale = 4
    S = size * scale
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # 渐变背景
    for y in range(S):
        t = y / (S - 1)
        r = int(PURPLE[0] * (1 - t) + CYAN[0] * t)
        g = int(PURPLE[1] * (1 - t) + CYAN[1] * t)
        b = int(PURPLE[2] * (1 - t) + CYAN[2] * t)
        draw.line([(0, y), (S, y)], fill=(r, g, b, 255))
    # 圆角遮罩
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    pad = int(S * 0.031)
    radius = int(S * 0.246)
    md.rounded_rectangle([pad, pad, S - pad, S - pad], radius=radius, fill=255)
    img.putalpha(mask)
    # 对话气泡
    bx1, by1, bx2, by2 = int(S*0.235), int(S*0.185), int(S*0.765), int(S*0.685)
    radius_b = int(S * 0.12)
    draw.rounded_rectangle([bx1, by1, bx2, by2], radius=radius_b, fill=(255,255,255,255))
    # 气泡尾巴
    tail = [(int(S*0.36), int(S*0.66)), (int(S*0.37), int(S*0.80)), (int(S*0.50), int(S*0.66))]
    draw.polygon(tail, fill=(255,255,255,255))
    # 循环箭头（反向）
    arc_box = [int(S*0.34), int(S*0.30), int(S*0.66), int(S*0.62)]
    draw.arc(arc_box, start=35, end=320, fill=NAVY, width=max(6, int(S*0.052)))
    # 箭头
    aw = int(S*0.06)
    ax, ay = int(S*0.635), int(S*0.37)
    draw.polygon([(ax, ay), (ax - aw, ay - int(aw*0.5)), (ax - int(aw*0.2), ay + aw)], fill=NAVY)
    # 中心点
    cx, cy = int(S*0.61), int(S*0.40)
    r = int(S*0.035)
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=PURPLE)
    return img.resize((size, size), Image.LANCZOS)


def rounded(draw, box, radius, fill, outline=None, width=0):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def font(size, bold=True):
    path = r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc"
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def center_text(draw, y, text, f, fill, width):
    bbox = draw.textbbox((0, 0), text, font=f)
    w = bbox[2] - bbox[0]
    draw.text(((width - w) / 2 - bbox[0], y), text, font=f, fill=fill)


def _card(draw, x, y, w, h, title, body, color):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=22, fill=PANEL)
    draw.rectangle([x, y, x + 8, y + h], fill=color)
    draw.text((x + 24, y + 16), title, font=font(27), fill=TEXT)
    draw.multiline_text((x + 24, y + 62), body, font=font(19, False), fill=MUTED, spacing=8)


def _section(draw, y, title, color=CYAN):
    draw.rectangle([80, y, 92, y + 36], fill=color)
    draw.text((112, y - 3), title, font=font(34), fill=TEXT)


def make_poster(path=None):
    W, H = 1080, 2800
    path = path or os.path.join(DOCS, "费曼反向学校宣传图.png")
    img = Image.new("RGB", (W, H), DARK)
    draw = ImageDraw.Draw(img)
    # 背景渐变
    for y in range(H):
        t = y / (H - 1)
        r = int(7 * (1 - t) + 12 * t)
        g = int(11 * (1 - t) + 20 * t)
        b = int(22 * (1 - t) + 45 * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([-180, -120, 520, 520], fill=(109, 140, 255, 34))
    od.ellipse([W - 430, 120, W + 160, 710], fill=(34, 211, 238, 28))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    icon = Image.open(os.path.join(TOOL_ASSETS, "icon.png")).convert("RGBA").resize((180, 180), Image.LANCZOS)
    img.paste(icon, (int((W - 180) / 2), 60), icon)
    center_text(draw, 285, "费曼反向学校", font(64), TEXT, W)
    center_text(draw, 365, "教会 AI 才算学会", font(40), CYAN, W)
    center_text(draw, 420, "输出倒逼输入 · AI 越笨，用户越强", font(24, False), MUTED, W)

    # 1 为什么
    _section(draw, 520, "为什么学了就忘？", WARN)
    items = [
        ("只看不输出", "知识只是从眼前经过，没有真正进入大脑。"),
        ("以为懂了", "看懂别人的讲解，和能自己讲清楚，是两种能力。"),
        ("缺少反馈", "没有人追问、挑错、要例子，盲点永远藏着。"),
    ]
    y = 580
    for t, b in items:
        draw.rounded_rectangle([80, y, W - 80, y + 78], radius=18, fill=PANEL)
        draw.ellipse([104, y + 26, 130, y + 52], fill=WARN)
        draw.text((150, y + 14), t, font=font(25), fill=TEXT)
        draw.text((360, y + 18), b, font=font(19, False), fill=MUTED)
        y += 94

    # 2 三步
    _section(draw, 900, "三步把 AI 教会", CYAN)
    steps = [
        ("01", "用户讲解", "用自己的话讲清定义、原理和例子。"),
        ("02", "AI 学生", "主动追问、故意犯错、要求举例。"),
        ("03", "考试通关", "AI 真正学会后，输出通过判定。"),
    ]
    x = 80
    for num, t, b in steps:
        draw.rounded_rectangle([x, 960, x + 296, 1190], radius=24, fill=PANEL)
        draw.text((x + 26, 984), num, font=font(34), fill=CYAN)
        draw.text((x + 26, 1042), t, font=font(28), fill=TEXT)
        draw.multiline_text((x + 26, 1098), b, font=font(19, False), fill=MUTED, spacing=8)
        if x < 700:
            draw.text((x + 305, 1050), "→", font=font(34), fill=MUTED)
        x += 320

    # 3 六大优势
    _section(draw, 1240, "六大核心优势", PURPLE)
    advantages = [
        ("输出倒逼输入", "必须讲出来，输入自然更认真、更主动。"),
        ("AI 学生机制", "追问、犯错、要例子，持续暴露理解盲点。"),
        ("考试式通关", "达到标准才通过，学习结果可感知。"),
        ("多模态输入", "文本、Markdown、LaTeX、图片识图。"),
        ("沉浸式体验", "流式回复、移动端适配、进度可视化。"),
        ("商业化闭环", "激活码、时长/次数、后台统计一键打通。"),
    ]
    positions = [(80, 1300), (560, 1300), (80, 1470), (560, 1470), (80, 1640), (560, 1640)]
    for (t, b), (cx, cy) in zip(advantages, positions):
        _card(draw, cx, cy, 440, 145, t, b, PURPLE if cy < 1400 else CYAN)

    # 4 功能亮点
    _section(draw, 1820, "功能亮点", GREEN)
    lines = [
        "Markdown + LaTeX：公式、表格、代码块都能正常显示。",
        "DeepSeek 视觉识图：图片自动识别文字和公式并整理排版。",
        "逐字流式回复：像真实对话一样自然，学习节奏更顺畅。",
        "账号与余额可恢复：换设备也能用激活码找回，余额不丢。",
    ]
    yy = 1880
    for line in lines:
        draw.ellipse([96, yy + 9, 112, yy + 25], fill=GREEN)
        draw.text((132, yy), line, font=font(20, False), fill=TEXT)
        yy += 52

    # 5 适合谁
    _section(draw, 2100, "适合谁用", WARN)
    users = [
        ("学生 / 备考党", "数学、物理、计算机、考研、雅思托福。"),
        ("知识工作者", "快速吃透新领域，写作前先讲一遍。"),
        ("教师 / 培训师", "用反向教学检验自己是否真懂。"),
        ("自学者", "读书、看课后，把知识讲给 AI 听。"),
    ]
    ux, uy = 80, 2160
    for i, (t, b) in enumerate(users):
        _card(draw, ux, uy, 440, 90, t, b, WARN)
        if i % 2 == 1:
            ux = 80; uy += 108
        else:
            ux = 560

    # 二维码与结尾
    import qrcode
    qr = qrcode.QRCode(box_size=8, border=1)
    qr.add_data("https://hu080608.github.io/feynman-reverse-school/")
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="#0b1020", back_color="white").convert("RGB").resize((180, 180), Image.NEAREST)
    frame = Image.new("RGB", (204, 204), (255, 255, 255))
    frame.paste(qr_img, (12, 12))
    img.paste(frame, (80, 2440))
    draw.text((320, 2460), "扫码体验", font=font(32), fill=TEXT)
    draw.text((320, 2505), "https://hu080608.github.io/", font=font(20, False), fill=MUTED)
    draw.text((320, 2537), "feynman-reverse-school/", font=font(20, False), fill=MUTED)
    draw.text((320, 2585), "教会 AI，才算学会。", font=font(24), fill=CYAN)
    draw.text((80, 2690), "制作者：胡胜杰 · v1.3", font=font(18, False), fill=MUTED)

    try:
        img.save(path, "PNG")
    except PermissionError:
        alt = os.path.splitext(path)[0] + "_v2.png"
        img.save(alt, "PNG")
        path = alt
    print("已生成：" + path)


def main():
    svg = make_icon_svg()
    with open(os.path.join(ASSETS, "logo.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    with open(os.path.join(ASSETS, "logo-pure.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    icon = draw_icon_png(512)
    icon.save(os.path.join(TOOL_ASSETS, "icon.png"), "PNG")
    icon.save(os.path.join(TOOL_ASSETS, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    icon.save(os.path.join(ASSETS, "logo.png"), "PNG")
    make_poster()
    print("品牌资产生成完成。")


if __name__ == "__main__":
    main()
