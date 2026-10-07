#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
费曼反向学校 - 激活码生成器 GUI（HMAC-SHA256 v2，与 Cloudflare Worker 一致）
"""
import base64, csv, hashlib, hmac, json, os, re, time, tkinter as tk, uuid
from tkinter import filedialog, messagebox, ttk

TITLE = "费曼反向学校 - 激活码生成器"

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")

def parse_duration(text: str) -> int:
    s = (text or "").strip().lower()
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hour|d|day)?$", s)
    if not m:
        return 0
    v = float(m.group(1)); u = m.group(2) or "s"
    if u.startswith("d"): return round(v * 86400)
    if u.startswith("h"): return round(v * 3600)
    if u.startswith("m"): return round(v * 60)
    return round(v)

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(TITLE)
        self.geometry("820x640")
        self.minsize(760, 560)
        self.configure(bg="#0b1020")
        self.style = ttk.Style(self)
        try: self.style.theme_use("clam")
        except tk.TclError: pass
        self.style.configure(".", background="#0b1020", foreground="#eef4ff", fieldbackground="#101a30")
        self.style.configure("TLabel", background="#0b1020", foreground="#c9d7ff")
        self.style.configure("TFrame", background="#0b1020")
        self.style.configure("Primary.TButton", foreground="#06101f", background="#6d8cff")
        self._build()
        self._sync_type()

    def _build(self):
        pad = {"padx": 12, "pady": 6}
        main = ttk.Frame(self, padding=16); main.pack(fill="both", expand=True)
        tk.Label(main, text="费曼反向学校 · 激活码生成器", font=("Microsoft YaHei", 18, "bold"),
                 bg="#0b1020", fg="#eef4ff").pack(anchor="w")
        tk.Label(main, text="密钥必须与 Cloudflare Worker 的 LICENSE_SECRET 完全一致；兑换后全平台只能使用一次。",
                 bg="#0b1020", fg="#93a6cf", font=("Microsoft YaHei", 10)).pack(anchor="w", pady=(0, 10))
        form = ttk.Frame(main); form.pack(fill="x")
        self.secret = tk.StringVar(); self.pid = tk.StringVar(value="trial_1h")
        self.pname = tk.StringVar(value="体验装-1小时"); self.typ = tk.StringVar(value="time")
        self.duration = tk.StringVar(value="1h"); self.uses = tk.StringVar(value="20")
        self.valid_days = tk.StringVar(value="7"); self.count = tk.StringVar(value="10")
        self.out = tk.StringVar(value=os.path.abspath("codes.csv"))
        def lab(t, r): ttk.Label(form, text=t).grid(row=r, column=0, sticky="w", **pad)
        def ent(var, r, show=None):
            e = ttk.Entry(form, textvariable=var, width=52, show=show)
            e.grid(row=r, column=1, sticky="we", **pad); return e
        lab("LICENSE_SECRET", 0); ent(self.secret, 0, show="●")
        lab("商品编号 / pid", 1); ent(self.pid, 1)
        lab("商品名称", 2); ent(self.pname, 2)
        lab("套餐类型", 3)
        box = ttk.Frame(form); box.grid(row=3, column=1, sticky="w", **pad)
        ttk.Radiobutton(box, text="时长 time", value="time", variable=self.typ, command=self._sync_type).pack(side="left", padx=(0,14))
        ttk.Radiobutton(box, text="次数 count", value="count", variable=self.typ, command=self._sync_type).pack(side="left")
        lab("时长（1h / 1d / 30m）", 4); self.duration_entry = ent(self.duration, 4)
        lab("次数", 5); self.uses_entry = ent(self.uses, 5)
        lab("激活码有效期（天）", 6); ent(self.valid_days, 6)
        lab("生成数量", 7); ent(self.count, 7)
        lab("输出 CSV", 8)
        outbox = ttk.Frame(form); outbox.grid(row=8, column=1, sticky="we", **pad)
        ttk.Entry(outbox, textvariable=self.out).pack(side="left", fill="x", expand=True)
        ttk.Button(outbox, text="选择...", command=self._choose).pack(side="left", padx=(6,0))
        form.columnconfigure(1, weight=1)
        btns = ttk.Frame(main); btns.pack(fill="x", pady=(10,6))
        ttk.Button(btns, text="生成激活码", style="Primary.TButton", command=self.generate).pack(side="left")
        ttk.Button(btns, text="复制全部", command=self.copy_all).pack(side="left", padx=8)
        ttk.Button(btns, text="清空结果", command=lambda: self.result.delete("1.0","end")).pack(side="left")
        self.result = tk.Text(main, height=14, bg="#070b16", fg="#d8e3ff", relief="flat",
                              wrap="none", font=("Consolas", 10))
        self.result.pack(fill="both", expand=True, pady=(4,0))

    def _sync_type(self):
        if self.typ.get() == "time":
            self.duration_entry.configure(state="normal"); self.uses_entry.configure(state="disabled")
        else:
            self.duration_entry.configure(state="disabled"); self.uses_entry.configure(state="normal")

    def _choose(self):
        p = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")])
        if p: self.out.set(p)

    def generate(self):
        secret = self.secret.get().strip(); pid = self.pid.get().strip()
        pname = self.pname.get().strip() or pid; typ = self.typ.get().strip().lower()
        if not secret: return messagebox.showerror("错误", "请输入 LICENSE_SECRET")
        if not pid: return messagebox.showerror("错误", "请输入商品编号")
        if typ not in ("time", "count"): return messagebox.showerror("错误", "类型必须是 time 或 count")
        try:
            count = max(1, int(float(self.count.get() or "1")))
            valid_days = max(0.0, float(self.valid_days.get() or "0"))
        except ValueError:
            return messagebox.showerror("错误", "生成数量 / 有效期必须是数字")
        if typ == "time":
            duration_seconds = parse_duration(self.duration.get())
            if duration_seconds <= 0: return messagebox.showerror("错误", "时长格式不对，例如 1h、1d、30m、3600s")
            uses = None
        else:
            duration_seconds = None
            try: uses = int(float(self.uses.get() or "0"))
            except ValueError: return messagebox.showerror("错误", "次数必须是数字")
            if uses <= 0: return messagebox.showerror("错误", "次数必须大于 0")

        now = int(time.time()); exp = now + int(valid_days * 86400)
        rows = [["code","pid","pname","type","durationSeconds","uses","iat","exp","jti"]]
        codes = []
        for _ in range(count):
            payload = {"v":2,"jti":str(uuid.uuid4()),"pid":pid,"pname":pname,"type":typ,"iat":now,"exp":exp}
            if typ == "time": payload["durationSeconds"] = duration_seconds
            else: payload["uses"] = uses
            text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            sig = hmac.new(secret.encode("utf-8"), text.encode("utf-8"), hashlib.sha256).digest()
            code = b64url(text.encode("utf-8")) + "." + b64url(sig)
            codes.append(code)
            rows.append([code,pid,pname,typ,duration_seconds or "",uses or "",now,exp,payload["jti"]])
        out_path = self.out.get().strip() or os.path.abspath("codes.csv")
        try:
            with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
                csv.writer(f).writerows(rows)
        except OSError as e:
            return messagebox.showerror("写入失败", str(e))
        self.result.delete("1.0","end"); self.result.insert("end", "\n".join(codes))
        messagebox.showinfo("成功", f"已生成 {count} 个激活码。\n\nCSV 已保存：\n{out_path}")

    def copy_all(self):
        text = self.result.get("1.0","end").strip()
        if not text: return messagebox.showinfo("提示", "还没有生成结果")
        self.clipboard_clear(); self.clipboard_append(text)
        messagebox.showinfo("成功", "已复制全部激活码")

if __name__ == "__main__":
    App().mainloop()
