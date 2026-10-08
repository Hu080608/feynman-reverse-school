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


def make_poster(path=None):
    W, H = 1080, 1920
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
    # 氛围圆
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([-180, -120, 520, 520], fill=(109, 140, 255, 34))
    od.ellipse([W - 430, 120, W + 160, 710], fill=(34, 211, 238, 28))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    # 顶部图标
    icon = Image.open(os.path.join(TOOL_ASSETS, "icon.png")).convert("RGBA")
    icon = icon.resize((220, 220), Image.LANCZOS)
    img.paste(icon, (int((W - 220) / 2), 110), icon)

    # 标题
    center_text(draw, 370, "费曼反向学校", font(72), TEXT, W)
    center_text(draw, 470, "教会 AI 才算学会", font(44), CYAN, W)
    center_text(draw, 550, "输出倒逼输入 · AI 越笨，用户越强", font(28, False), MUTED, W)

    # 卡片
    cards = [
        ("AI 装傻学生", "主动追问 · 故意犯错 · 要求举例\n讲不清时，它绝不假装懂", PURPLE),
        ("考试式通关", "用户把知识点讲给 AI 听\nAI 真正学会并通过考试，才算通关", CYAN),
        ("多模态学习", "支持 Markdown / LaTeX / 图片识图\n自动整理排版，学习结果看得见", GREEN),
    ]
    y = 700
    for title, body, color in cards:
        rounded(draw, [80, y, W - 80, y + 230], 34, PANEL, LINE if False else None)
        draw.rectangle([80, y, 92, y + 230], fill=color)
        draw.text((130, y + 38), title, font=font(38), fill=TEXT)
        draw.multiline_text((130, y + 110), body, font=font(25, False), fill=MUTED, spacing=12)
        y += 270

    # 底部二维码
    import qrcode
    qr = qrcode.QRCode(box_size=10, border=1)
    qr.add_data("https://hu080608.github.io/feynman-reverse-school/")
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="#0b1020", back_color="white").convert("RGB").resize((240, 240), Image.NEAREST)
    frame = Image.new("RGB", (272, 272), (255, 255, 255))
    frame.paste(qr_img, (16, 16))
    img.paste(frame, (100, 1560))
    draw.text((400, 1578), "扫码体验", font=font(30), fill=TEXT)
    draw.multiline_text((400, 1625), "https://hu080608.github.io/\nfeynman-reverse-school/", font=font(20, False), fill=MUTED, spacing=8)

    img.save(path, "PNG")
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
