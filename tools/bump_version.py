#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""自动递增补丁版本号，并同步到网页配置和 EXE 生成器。"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    version_path = os.path.join(ROOT, "tools", "version.json")
    data = json.load(open(version_path, encoding="utf-8"))
    parts = [int(x) for x in data["version"].split(".")]
    parts[2] += 1
    new_version = ".".join(str(x) for x in parts)
    data["version"] = new_version
    with open(version_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 更新网页配置
    cfg_path = os.path.join(ROOT, "js", "config.js")
    cfg = open(cfg_path, encoding="utf-8").read()
    cfg = re.sub(r'version:\s*"v\d+\.\d+\.\d+"', f'version: "v{new_version}"', cfg, count=1)
    open(cfg_path, "w", encoding="utf-8").write(cfg)

    # 更新 EXE GUI
    gui_path = os.path.join(ROOT, "tools", "generate_codes_gui.py")
    gui = open(gui_path, encoding="utf-8").read()
    gui = re.sub(r'VERSION\s*=\s*"v\d+\.\d+\.\d+"', f'VERSION = "v{new_version}"', gui, count=1)
    open(gui_path, "w", encoding="utf-8").write(gui)

    print(f"版本已更新为 v{new_version}")


if __name__ == "__main__":
    main()
