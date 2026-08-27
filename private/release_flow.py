#!/usr/bin/env python3
"""Create a compatible next-version workspace from the current source tree."""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
EXCLUDED_DIRS = {".git", ".venv", "venv", "__pycache__", "data", "private", "backups", ".pytest_cache", "node_modules", "_dev_archive", "python"}
EXCLUDED_FILES = {"agent.db", "tmp_scout.py"}

# ===== 发布版密钥清除（只处理发布副本，本地源文件不动）=====
# models.js 预置线路中的真实 key、私有会话 headers 不得进入发布版。
# 清除规则：key 值长度 >= 8 的清空为 ''（'free' 占位与空值不受影响）。
KEY_LINE_RE = re.compile(r"(key\s*:\s*)(['\"])([^'\"]{8,})\2")
HEADERS_BLOCK_RE = re.compile(r",\s*headers\s*:\s*\{[^{}]*\}")
# 泄漏兜底扫描：常见真实密钥形态
LEAK_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9._\-]{16,}"),
    re.compile(r"\bbce-v3/[A-Za-z0-9._\-]{16,}"),
    re.compile(r"\bark-[0-9a-f]{8}-[0-9a-f\-]{16,}"),
    re.compile(r"[a-f0-9]{32}\.[A-Za-z0-9]{16}"),
]


def validate_version(version: str) -> str:
    version = version.strip().lstrip("vV")
    if not VERSION_RE.fullmatch(version):
        raise ValueError("Version must use X.Y.Z format, for example 4.0.2")
    return version


def ignored_names(_: str, names: list[str]) -> set[str]:
    return {name for name in names if name in EXCLUDED_DIRS or name in EXCLUDED_FILES or name.endswith((".pyc", ".bak"))}


def strip_models_js_secrets(target: Path) -> list[str]:
    """清空发布副本 models.js 预置线路的真实密钥，并删除私有会话 headers。"""
    scrubbed: list[str] = []
    models_js = target / "public" / "js" / "models.js"
    if not models_js.exists():
        return scrubbed
    text = models_js.read_text(encoding="utf-8")
    original = text

    def _blank(match: re.Match) -> str:
        # 'free' 占位（本地生图/免费线路）与空值不经过这里（长度不足 8）
        return match.group(1) + "''"

    text = KEY_LINE_RE.sub(_blank, text)
    text = HEADERS_BLOCK_RE.sub("", text)
    if text != original:
        models_js.write_text(text, encoding="utf-8")
        scrubbed.append(str(models_js.relative_to(target)))
    return scrubbed


def find_leaked_keys(target: Path) -> list[str]:
    """安全网：扫描发布副本前端文件，检测是否有漏网的真实密钥形态。"""
    leaks: list[str] = []
    public_dir = target / "public"
    scan_root = public_dir if public_dir.exists() else target
    for path in scan_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in {".js", ".html", ".json", ".css"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pattern in LEAK_PATTERNS:
            if pattern.search(text):
                leaks.append(f"{path.relative_to(target)} (匹配 {pattern.pattern})")
                break
    return leaks


def write_release_files(target: Path, version: str, summary: str, scrubbed: list[str]) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    default_summary = "Created from the current version with the same runtime and project layout."
    summary = summary or default_summary
    (target / "VERSION").write_text(version + "\n", encoding="utf-8")
    runtime = {
        "version": version,
        "created_at": now,
        "python_executable": sys.executable,
        "python_version": sys.version,
        "source_policy": "Copied from the current working tree. Do not replace or bundle another Python runtime.",
        "secrets_scrubbed": scrubbed,
    }
    (target / "release-runtime.json").write_text(json.dumps(runtime, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    changelog = target / "CHANGELOG.md"
    previous = changelog.read_text(encoding="utf-8") if changelog.exists() else "# Changelog\n\n"
    changelog.write_text(previous + f"## {version} - {now}\n\n- {summary}\n- 发布版已自动清除预置线路真实密钥（{', '.join(scrubbed) if scrubbed else '无需清除'}）\n\n", encoding="utf-8")
    help_file = target / "HELP.md"
    help_text = help_file.read_text(encoding="utf-8") if help_file.exists() else "# Help\n\n"
    help_text += "\n## New Version Flow\n\nUse Project Management > Create Version. It copies the current workspace, records the active Python runtime, updates version and release documents, and excludes private settings, databases, caches, virtual environments, and backups. Preset model keys in `public/js/models.js` are automatically blanked in the release copy, so users must fill in their own API keys.\n"
    help_file.write_text(help_text, encoding="utf-8")
    (target / "RELEASE.md").write_text(f"# Release {version}\n\n## Checklist\n\n1. Confirm `VERSION`, `CHANGELOG.md`, and `HELP.md`.\n2. Run checks with the Python recorded in `release-runtime.json`; do not replace the runtime.\n3. Add required private settings under `private/`, without committing keys.\n4. Run `python -m compileall server scripts`, then commit and publish.\n5. Verify no real API keys: preset keys are auto-blanked (see `release-runtime.json` > `secrets_scrubbed`).\n\n## Summary\n\n{summary}\n\n## Secrets\n\nPreset model keys were scrubbed from: {', '.join(scrubbed) if scrubbed else 'nothing (already clean)'}.\n", encoding="utf-8")
    private_readme = target / "private" / "README.md"
    private_readme.parent.mkdir(exist_ok=True)
    private_readme.write_text("Store machine-local private configuration here. Do not commit this directory.\n", encoding="utf-8")


def create_release(source: Path, version: str, summary: str = "", output_root: Path | None = None) -> dict:
    version = validate_version(version)
    source = source.resolve()
    output_root = (output_root or source.parent).resolve()
    target = output_root / f"{source.name.rsplit('_', 1)[0]}_{version}"
    if target.exists():
        raise FileExistsError(f"Target directory already exists: {target}")
    shutil.copytree(source, target, ignore=ignored_names)
    scrubbed = strip_models_js_secrets(target)
    leaks = find_leaked_keys(target)
    if leaks:
        shutil.rmtree(target, ignore_errors=True)
        raise RuntimeError("发布中止：检测到疑似真实密钥残留 -> " + "; ".join(leaks))
    write_release_files(target, version, summary.strip(), scrubbed)
    return {"ok": True, "version": version, "source": str(source), "target": str(target), "python": sys.executable, "secrets_scrubbed": scrubbed}


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a compatible next-version workspace")
    parser.add_argument("version")
    parser.add_argument("--summary", default="")
    parser.add_argument("--source", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--output-root", default=None)
    args = parser.parse_args()
    result = create_release(Path(args.source), args.version, args.summary, Path(args.output_root) if args.output_root else None)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
