#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
费曼反向学校 - 激活码生成器 GUI（HMAC-SHA256 v2，与 Cloudflare Worker 一致）
使用 customtkinter 构建现代界面。
"""
import base64, csv, hashlib, hmac, json, os, re, sys, time, uuid
import tkinter as tk
from tkinter import filedialog, messagebox
import customtkinter as ctk
from PIL import Image

APP_TITLE = "费曼反向学校 · 激活码生成器"
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")


def resource_path(rel):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def parse_duration(text: str) -> int:
    s = (text or "").strip().lower()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hour|d|day)?$", s)
    if not m:
        return 0
    value = float(m.group(1))
    unit = m.group(2) or "s"
    if unit.startswith("d"):
        return round(value * 86400)
    if unit.startswith("h"):
        return round(value * 3600)
    if unit.startswith("m"):
        return round(value * 60)
    return round(value)


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("940x780")
        self.minsize(860, 700)
        self.configure(fg_color="#080d19")
        self._set_icon()
        self._build_vars()
        self._build_ui()
        self._sync_type()

    def _set_icon(self):
        try:
            self.iconbitmap(resource_path("assets/icon.ico"))
        except Exception:
            try:
                self.iconphoto(True, tk.PhotoImage(file=resource_path("assets/icon.png")))
            except Exception:
                pass

    def _build_vars(self):
        self.secret = tk.StringVar(value="")
        self.pid = tk.StringVar(value="trial_1h")
        self.pname = tk.StringVar(value="体验装-1小时")
        self.typ = tk.StringVar(value="时长 time")
        self.duration = tk.StringVar(value="1h")
        self.uses = tk.StringVar(value="20")
        self.valid_days = tk.StringVar(value="7")
        self.count = tk.StringVar(value="10")
        self.out = tk.StringVar(value=os.path.abspath("codes.csv"))
        self.status_var = tk.StringVar(value="就绪")

    def _build_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        header = ctk.CTkFrame(self, fg_color="#0d1526", corner_radius=22)
        header.grid(row=0, column=0, sticky="ew", padx=18, pady=(18, 12))
        header.grid_columnconfigure(1, weight=1)
        try:
            logo = ctk.CTkImage(light_image=Image.open(resource_path("assets/icon.png")),
                                dark_image=Image.open(resource_path("assets/icon.png")), size=(70, 70))
            ctk.CTkLabel(header, image=logo, text="").grid(row=0, column=0, rowspan=2, padx=(18, 14), pady=16)
            self._logo = logo
        except Exception:
            pass
        ctk.CTkLabel(header, text="费曼反向学校 · 激活码生成器",
                     font=ctk.CTkFont(family="Microsoft YaHei UI", size=24, weight="bold"),
                     text_color="#eef4ff").grid(row=0, column=1, sticky="sw", padx=(0, 18), pady=(16, 0))
        ctk.CTkLabel(header, text="HMAC-SHA256 v2 · 与 Cloudflare Worker 完全一致 · 兑换后全平台一次核销",
                     font=ctk.CTkFont(family="Microsoft YaHei UI", size=13),
                     text_color="#8fa6d8").grid(row=1, column=1, sticky="nw", padx=(0, 18), pady=(0, 16))

        body = ctk.CTkFrame(self, fg_color="transparent")
        body.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 14))
        body.grid_columnconfigure(0, weight=1)
        body.grid_rowconfigure(1, weight=1)

        form_card = ctk.CTkFrame(body, fg_color="#0d1526", corner_radius=18)
        form_card.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        form_card.grid_columnconfigure(1, weight=1)
        ctk.CTkLabel(form_card, text="生成信息", font=ctk.CTkFont(family="Microsoft YaHei UI", size=16, weight="bold"),
                     text_color="#dbe7ff").grid(row=0, column=0, columnspan=2, sticky="w", padx=18, pady=(16, 8))

        def label(text, r):
            ctk.CTkLabel(form_card, text=text, font=ctk.CTkFont(family="Microsoft YaHei UI", size=13),
                         text_color="#a9bbdf").grid(row=r, column=0, sticky="w", padx=(18, 12), pady=7)

        def entry(var, r, show=None):
            e = ctk.CTkEntry(form_card, textvariable=var, show=show, height=38,
                             fg_color="#070c16", border_color="#243659", text_color="#eef4ff")
            e.grid(row=r, column=1, sticky="ew", padx=(0, 18), pady=7)
            return e

        label("LICENSE_SECRET", 1); e_secret = entry(self.secret, 1, show="●")
        label("商品编号 / pid", 2); entry(self.pid, 2)
        label("商品名称", 3); entry(self.pname, 3)
        label("套餐类型", 4)
        type_box = ctk.CTkFrame(form_card, fg_color="transparent")
        type_box.grid(row=4, column=1, sticky="w", padx=(0, 18), pady=7)
        self.type_seg = ctk.CTkSegmentedButton(type_box, values=["时长 time", "次数 count"],
                                               variable=self.typ, command=self._sync_type)
        self.type_seg.pack(anchor="w")
        label("时长（1h / 1d / 30m）", 5); self.duration_entry = entry(self.duration, 5)
        label("次数", 6); self.uses_entry = entry(self.uses, 6)
        label("激活码有效期（天）", 7); entry(self.valid_days, 7)
        label("生成数量", 8); entry(self.count, 8)
        label("输出 CSV", 9)
        out_row = ctk.CTkFrame(form_card, fg_color="transparent")
        out_row.grid(row=9, column=1, sticky="ew", padx=(0, 18), pady=7)
        out_row.grid_columnconfigure(0, weight=1)
        ctk.CTkEntry(out_row, textvariable=self.out, height=38, fg_color="#070c16",
                     border_color="#243659", text_color="#eef4ff").grid(row=0, column=0, sticky="ew")
        ctk.CTkButton(out_row, text="选择...", width=80, height=38, fg_color="#1b2747",
                      hover_color="#26365f", command=self._choose).grid(row=0, column=1, padx=(8, 0))

        actions = ctk.CTkFrame(body, fg_color="transparent")
        actions.grid(row=1, column=0, sticky="ew", pady=(0, 10))
        ctk.CTkButton(actions, text="生成激活码", height=42, width=150,
                      font=ctk.CTkFont(family="Microsoft YaHei UI", size=14, weight="bold"),
                      fg_color="#6d8cff", hover_color="#8aa4ff", text_color="#06101f",
                      command=self.generate).pack(side="left")
        ctk.CTkButton(actions, text="复制全部", height=42, width=110, fg_color="#1b2747",
                      hover_color="#26365f", command=self.copy_all).pack(side="left", padx=10)
        ctk.CTkButton(actions, text="清空结果", height=42, width=110, fg_color="#1b2747",
                      hover_color="#26365f", command=lambda: self.result.delete("1.0", "end")).pack(side="left")

        result_card = ctk.CTkFrame(body, fg_color="#0d1526", corner_radius=18)
        result_card.grid(row=2, column=0, sticky="nsew")
        result_card.grid_columnconfigure(0, weight=1)
        result_card.grid_rowconfigure(1, weight=1)
        ctk.CTkLabel(result_card, text="生成结果", font=ctk.CTkFont(family="Microsoft YaHei UI", size=15, weight="bold"),
                     text_color="#dbe7ff").grid(row=0, column=0, sticky="w", padx=18, pady=(14, 6))
        self.result = ctk.CTkTextbox(result_card, fg_color="#070c16", text_color="#d8e3ff",
                                     font=ctk.CTkFont(family="Consolas", size=12), corner_radius=10)
        self.result.grid(row=1, column=0, sticky="nsew", padx=14, pady=(0, 10))
        ctk.CTkLabel(self, textvariable=self.status_var, anchor="w",
                     font=ctk.CTkFont(family="Microsoft YaHei UI", size=12),
                     text_color="#7f96c9").grid(row=2, column=0, sticky="ew", padx=24, pady=(0, 12))

    def _sync_type(self, *_):
        is_time = self.typ.get().startswith("时长")
        self.duration_entry.configure(state="normal" if is_time else "disabled")
        self.uses_entry.configure(state="disabled" if is_time else "normal")

    def _choose(self):
        p = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")])
        if p:
            self.out.set(p)

    def generate(self):
        secret = self.secret.get().strip()
        pid = self.pid.get().strip()
        pname = self.pname.get().strip() or pid
        is_time = self.typ.get().startswith("时长")
        if not secret:
            return messagebox.showerror("错误", "请输入 LICENSE_SECRET")
        if not pid:
            return messagebox.showerror("错误", "请输入商品编号")
        try:
            count = max(1, int(float(self.count.get() or "1")))
            valid_days = max(0.0, float(self.valid_days.get() or "0"))
        except ValueError:
            return messagebox.showerror("错误", "生成数量 / 有效期必须是数字")
        if is_time:
            duration_seconds = parse_duration(self.duration.get())
            if duration_seconds <= 0:
                return messagebox.showerror("错误", "时长格式不对，例如 1h、1d、30m、3600s")
            uses = None
        else:
            duration_seconds = None
            try:
                uses = int(float(self.uses.get() or "0"))
            except ValueError:
                return messagebox.showerror("错误", "次数必须是数字")
            if uses <= 0:
                return messagebox.showerror("错误", "次数必须大于 0")
        now = int(time.time())
        exp = now + int(valid_days * 86400)
        rows = [["code", "pid", "pname", "type", "durationSeconds", "uses", "iat", "exp", "jti"]]
        codes = []
        for _ in range(count):
            payload = {"v": 2, "jti": str(uuid.uuid4()), "pid": pid, "pname": pname,
                       "type": "time" if is_time else "count", "iat": now, "exp": exp}
            if is_time:
                payload["durationSeconds"] = duration_seconds
            else:
                payload["uses"] = uses
            text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            sig = hmac.new(secret.encode("utf-8"), text.encode("utf-8"), hashlib.sha256).digest()
            code = b64url(text.encode("utf-8")) + "." + b64url(sig)
            codes.append(code)
            rows.append([code, pid, pname, "time" if is_time else "count",
                         duration_seconds or "", uses or "", now, exp, payload["jti"]])
        out_path = self.out.get().strip() or os.path.abspath("codes.csv")
        try:
            with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
                csv.writer(f).writerows(rows)
        except OSError as e:
            return messagebox.showerror("写入失败", str(e))
        self.result.delete("1.0", "end")
        self.result.insert("end", "\n".join(codes))
        self.status_var.set(f"已生成 {count} 个激活码 · {out_path}")
        messagebox.showinfo("成功", f"已生成 {count} 个激活码。\n\nCSV 已保存：\n{out_path}")

    def copy_all(self):
        text = self.result.get("1.0", "end").strip()
        if not text:
            return messagebox.showinfo("提示", "还没有生成结果")
        self.clipboard_clear()
        self.clipboard_append(text)
        self.status_var.set("已复制全部激活码到剪贴板")
        messagebox.showinfo("成功", "已复制全部激活码")


if __name__ == "__main__":
    App().mainloop()
