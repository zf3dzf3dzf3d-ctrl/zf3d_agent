#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动更新检查器 — 多源回退检查版本并执行更新
纯标准库实现，零外部依赖

更新源优先级：备用服务器 → Gitee → GitHub

适配无限画布版项目结构：
  public/   — 前端文件
  server/   — 后端代码
  private/  — 配置+数据库（更新时只覆盖 config.json 模板，保留用户数据）
  tools/    — 工具脚本
  codely_agent/ — Agent 核心
"""

import hashlib
import json
import os
import re
import shutil
import zipfile
import tempfile
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime
import threading
import time


class UpdateChecker:
    """多源回退检查更新，下载并覆盖项目文件"""

    def __init__(self, config: dict = None):
        self.config = config or {}
        update_cfg = self.config.get("update", {})
        self.github_repo = update_cfg.get("github_repo", "zf3dzf3dzf3d-ctrl/zf3d_agent")
        self.gitee_repo = update_cfg.get("gitee_repo", "zf3d/zf3d_agent")
        self.backup_server = update_cfg.get("backup_server", "")
        self.oss_base = update_cfg.get("oss_base", "https://zf3d-img.oss-cn-guangzhou.aliyuncs.com/agent/release/")
        self.checksum_url = update_cfg.get("checksum_url", "")  # 校验和独立通道地址（可选，独立于更新包下载地址）
        self.current_version = update_cfg.get("current_version", self.config.get("version", "5.2.5"))
        self.check_interval_hours = update_cfg.get("check_interval_hours", 24)
        self.project_root = Path(self.config.get("project_root", "."))
        self._last_check_time = None
        self._cached_result = None

    def check_update(self, force: bool = False) -> dict:
        """多源检查是否有新版本，依次尝试备用服务器 → Gitee → GitHub"""
        if not force and self._cached_result and self._last_check_time:
            elapsed_hours = (datetime.now() - self._last_check_time).total_seconds() / 3600
            if elapsed_hours < self.check_interval_hours:
                return self._cached_result

        sources = [
            ("OSS", self._check_oss),
            ("自建服务器", self._check_backup_server),
            ("Gitee", self._check_gitee),
            ("GitHub", self._check_github),
        ]

        errors = []
        for source_name, check_func in sources:
            try:
                result = check_func()
                if result and result.get("latest_version"):
                    has_update = self._compare_version(result["latest_version"], self.current_version) > 0
                    result["has_update"] = has_update
                    result["current_version"] = self.current_version
                    result["source"] = source_name
                    if not has_update:
                        result["message"] = f"已是最新版本（{source_name}）"
                    self._cached_result = result
                    self._last_check_time = datetime.now()
                    self._consecutive_failures = 0
                    return result
            except Exception as e:
                errors.append(f"{source_name}: {e}")
                continue

        # 失败可见化：连续失败计数，供前端 /api/update-status 明确提示"更新源不可达"
        self._consecutive_failures = getattr(self, "_consecutive_failures", 0) + 1
        err_msg = "所有更新源均不可用: " + "; ".join(errors)
        if self._consecutive_failures >= 3:
            err_msg += f"（已连续 {self._consecutive_failures} 次检查失败，自动更新未生效，请检查网络或更新源配置）"
        return {"has_update": False, "error": err_msg, "consecutive_failures": self._consecutive_failures}

    def _check_github(self) -> dict:
        """从 GitHub API 获取最新 Release"""
        api_url = f"https://api.github.com/repos/{self.github_repo}/releases/latest"
        headers = {"Accept": "application/vnd.github.v3+json", "User-Agent": "ZF3D-Agent-Updater"}
        req = urllib.request.Request(api_url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode("utf-8"))

        download_url = ""
        for asset in data.get("assets", []):
            name = asset.get("name", "")
            if name.lower().endswith(".exe"):
                download_url = asset.get("browser_download_url", "")
                break
            if name.endswith(".zip") and not download_url:
                download_url = asset.get("browser_download_url", "")
        if not download_url:
            download_url = data.get("zipball_url", "")

        return {
            "latest_version": self._clean_version(data.get("tag_name", "")),
            "changelog": data.get("body", "无更新日志")[:2000],
            "download_url": download_url,
            "published_at": data.get("published_at", "")
        }

    def _check_gitee(self) -> dict:
        """从 Gitee API 获取最新 Release"""
        api_url = f"https://gitee.com/api/v5/repos/{self.gitee_repo}/releases/latest"
        req = urllib.request.Request(api_url, headers={"User-Agent": "ZF3D-Agent-Updater"})
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode("utf-8"))

        download_url = ""
        for asset in data.get("assets", []):
            name = asset.get("name", "")
            if name.lower().endswith(".exe"):
                download_url = asset.get("browser_download_url", "")
                break
            if name.endswith(".zip") and not download_url:
                download_url = asset.get("browser_download_url", "")

        return {
            "latest_version": self._clean_version(data.get("tag_name", "")),
            "changelog": data.get("body", "无更新日志")[:2000],
            "download_url": download_url,
            "published_at": data.get("created_at", "")
        }

    def _check_oss(self) -> dict:
        """从阿里云 OSS 读取 latest.json（首选源，发版只传 exe + 改 latest.json）"""
        if not self.oss_base:
            raise Exception("未配置 OSS 更新源")
        url = self.oss_base.rstrip("/") + "/latest.json"
        req = urllib.request.Request(url, headers={"User-Agent": "ZF3D-Agent-Updater", "Cache-Control": "no-cache"})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode("utf-8"))
        ver = self._clean_version(str(data.get("version", "")))
        # URL 优先用 latest.json 里的 url；否则按约定拼接 base + 文件名
        download_url = data.get("url", "") or f"{self.oss_base.rstrip('/')}/ZF-Agent-Setup-{ver}.exe"
        return {
            "latest_version": ver,
            "changelog": data.get("notes", data.get("changelog", "无更新日志"))[:2000],
            "download_url": download_url,
            "published_at": data.get("time", data.get("published_at", ""))
        }

    def _check_backup_server(self) -> dict:
        """从自建服务器检查版本"""
        if not self.backup_server:
            raise Exception("未配置备用服务器")
        url = self.backup_server.rstrip("/") + "/version.json"
        req = urllib.request.Request(url, headers={"User-Agent": "ZF3D-Agent-Updater"})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode("utf-8"))

        return {
            "latest_version": self._clean_version(data.get("version", "")),
            "changelog": data.get("changelog", "无更新日志")[:2000],
            "download_url": data.get("download_url", ""),
            "published_at": data.get("published_at", "")
        }

    def do_update(self, download_url: str) -> dict:
        """下载更新包并覆盖项目文件"""
        if not download_url:
            return {"success": False, "error": "下载地址为空"}

        temp_dir = None
        backup_dir = None

        try:
            temp_dir = Path(tempfile.mkdtemp(prefix="zf3d_update_"))
            zip_path = temp_dir / "update.zip"

            # 下载
            req = urllib.request.Request(download_url, headers={"User-Agent": "ZF3D-Agent-Updater"})
            resp = urllib.request.urlopen(req, timeout=300)

            with open(zip_path, "wb") as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)

            # SHA256 完整性校验（校验和从独立通道获取，不与更新包同源，防篡改）
            checksum_error = self._verify_checksum(zip_path)
            if checksum_error:
                return {"success": False, "error": checksum_error}

            # 解压
            extract_dir = temp_dir / "extracted"
            extract_dir.mkdir(exist_ok=True)
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(extract_dir)

            # 查找项目根目录（zip 内可能有一层包装文件夹）
            new_root = self._find_project_root(extract_dir)
            if not new_root:
                return {"success": False, "error": "更新包中未找到有效项目目录（缺少 public/ 或 server/）"}

            # 安全检查：更新包内不得含密钥/凭据类文件（白名单校验）
            security_error = self._security_scan_package(new_root)
            if security_error:
                return {"success": False, "error": f"更新包安全检查未通过，已中止安装: {security_error}"}

            # 备份当前项目（排除 private/db, __pycache__, .bak 等）
            backup_name = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            backup_dir = self.project_root / backup_name
            self._backup_project(self.project_root, backup_dir)

            # 覆盖文件（排除模式）
            exclude_patterns = {
                "__pycache__", ".pyc", ".pyo", ".DS_Store", "Thumbs.db",
                ".bak", ".git", "node_modules",
                "zf3d_canvas.db", "zf3d_canvas.db-wal", "zf3d_canvas.db-shm",
                "private",  # 用户配置与数据目录，更新包一律不覆盖
            }
            self._overlay_directory(new_root, self.project_root, exclude_patterns)

            # 更新后自愈检查：关键目录/文件必须存在，缺失立即回滚
            heal_error = self._post_update_health_check()
            if heal_error:
                raise RuntimeError(f"更新后自检失败（已触发回滚）: {heal_error}")

            # 更新配置文件版本号
            self._update_config_version()

            # 清理旧备份（只保留最近1个）
            self._cleanup_old_backups()

            # 清理临时目录
            shutil.rmtree(temp_dir, ignore_errors=True)
            return {"success": True, "message": "更新完成，请刷新页面以加载新版本"}

        except Exception as e:
            # 回滚
            if backup_dir and backup_dir.exists():
                self._restore_project(backup_dir, self.project_root)
            if temp_dir:
                shutil.rmtree(temp_dir, ignore_errors=True)
            return {"success": False, "error": f"更新失败: {e}"}

    def _sha256_of_file(self, path: Path) -> str:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()

    def _verify_checksum(self, zip_path: Path) -> str:
        """SHA256 校验。校验和通过独立通道（checksum_url 或 backup_server 的 .sha256）获取，
        不与更新包同源，防止下载源被篡改后包和校验一起作假。返回空串表示通过。"""
        expected = ""
        # 优先：config 中显式配置的独立校验和地址
        if self.checksum_url:
            try:
                req = urllib.request.Request(self.checksum_url, headers={"User-Agent": "ZF3D-Agent-Updater"})
                expected = urllib.request.urlopen(req, timeout=15).read().decode("utf-8").strip()
            except Exception as e:
                return f"获取校验和失败（独立通道不可达）: {e}"
        elif self.backup_server:
            # 回退：自建服务器上与更新包同名的 .sha256 文件（仍是独立于 zip 的请求）
            name = zip_path.name
            try:
                url = self.backup_server.rstrip("/") + "/" + name + ".sha256"
                req = urllib.request.Request(url, headers={"User-Agent": "ZF3D-Agent-Updater"})
                expected = urllib.request.urlopen(req, timeout=15).read().decode("utf-8").strip()
            except Exception as e:
                print(f"[auto-update] 警告: 回退获取 .sha256 失败（{url}）: {e}，本次更新跳过 SHA256 校验")
        if not expected:
            print("[auto-update] 警告: 未配置 checksum_url，本次更新跳过 SHA256 校验")
            return ""
        # 兼容 "<sha256>  filename" 格式
        actual = self._sha256_of_file(zip_path)
        expected_hash = expected.split()[0].lower()
        if actual != expected_hash:
            return f"SHA256 校验失败：预期 {expected_hash}，实际 {actual}，已拒绝安装（更新包可能不完整或被篡改）"
        return ""

    def _security_scan_package(self, package_root: Path) -> str:
        """更新包白名单安全检查：包内不得含密钥/凭据类文件。返回空串表示通过。"""
        # 文件名黑名单（精确或后缀匹配）
        forbidden_names = {
            ".env", ".env.local", ".pem", ".key", ".pfx", ".p12",
            "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
            "credentials.json", "secrets.json", "service-account.json",
            ".npmrc", ".netrc", ".git-credentials",
        }
        forbidden_suffixes = (".pem", ".key", ".pfx", ".p12", ".crt.bak", ".env")
        forbidden_dir_markers = (".ssh",)
        for path in package_root.rglob("*"):
            if not path.is_file():
                continue
            name = path.name.lower()
            if name in forbidden_names or name.endswith(forbidden_suffixes):
                return f"发现疑似密钥/凭据文件: {path.relative_to(package_root)}"
            if any(part in forbidden_dir_markers for part in path.parts):
                return f"发现疑似密钥目录: {path.relative_to(package_root)}"
            # 高熵内容粗检：py/js 中硬编码 api_key 赋值（轻量正则，避免误杀提示文本）
            if path.suffix.lower() in (".py", ".js", ".json", ".yaml", ".yml"):
                try:
                    head = path.read_text(encoding="utf-8", errors="ignore")[:200000]
                    m = re.search(r"(?i)(api[_-]?key|secret|token|password)\s*[=:]\s*['\"]([A-Za-z0-9_\-]{24,})['\"]", head)
                    if m and "your" not in m.group(2).lower() and "xxx" not in m.group(2).lower():
                        return f"发现疑似硬编码凭据: {path.relative_to(package_root)}"
                except Exception:
                    continue
        return ""

    def _post_update_health_check(self) -> str:
        """更新后自愈检查：关键目录/入口文件必须存在。返回空串表示通过。"""
        required = [
            "public",
            "server",
            "server/update_checker.py",
        ]
        # index.html 二选一位置
        if not ((self.project_root / "public" / "index.html").exists()
                or (self.project_root / "index.html").exists()):
            required.append("public/index.html")
        missing = [r for r in required if not (self.project_root / r).exists()]
        if missing:
            return "缺失关键文件: " + ", ".join(missing)
        return ""

    def _clean_version(self, version: str) -> str:
        version = version.strip()
        if version.startswith("v") or version.startswith("V"):
            version = version[1:]
        return version

    def _compare_version(self, va: str, vb: str) -> int:
        try:
            parts_a = [int(x) for x in va.split(".")]
            parts_b = [int(x) for x in vb.split(".")]
            length = max(len(parts_a), len(parts_b))
            parts_a += [0] * (length - len(parts_a))
            parts_b += [0] * (length - len(parts_b))
            for a, b in zip(parts_a, parts_b):
                if a > b:
                    return 1
                if a < b:
                    return -1
            return 0
        except (ValueError, AttributeError):
            return 0

    def _find_project_root(self, directory: Path) -> Path or None:
        """在解压目录中查找项目根目录（包含 public/ 或 server/ 的目录）"""
        # 直接检查
        if (directory / "public").exists() or (directory / "server").exists():
            return directory
        # 检查一层子目录
        for subdir in directory.iterdir():
            if subdir.is_dir():
                if (subdir / "public").exists() or (subdir / "server").exists():
                    return subdir
        return None

    def _backup_project(self, src: Path, dst: Path):
        """备份项目（排除大文件和临时文件）"""
        exclude_names = {"__pycache__", ".git", "node_modules", "backup_"}
        exclude_suffixes = {".pyc", ".pyo", ".bak", ".db", ".db-wal", ".db-shm", ".log"}
        self._copy_tree_filtered(src, dst, exclude_names, exclude_suffixes)

    def _copy_tree_filtered(self, src: Path, dst: Path, exclude_names: set, exclude_suffixes: set):
        dst.mkdir(parents=True, exist_ok=True)
        for item in src.iterdir():
            name = item.name
            if name in exclude_names:
                continue
            if any(name.endswith(suffix) for suffix in exclude_suffixes):
                continue
            # 跳过其他备份目录
            if name.startswith("backup_") and name != "backup_data":
                continue
            dst_item = dst / name
            if item.is_dir():
                self._copy_tree_filtered(item, dst_item, exclude_names, exclude_suffixes)
            else:
                shutil.copy2(str(item), str(dst_item))

    def _overlay_directory(self, src: Path, dst: Path, exclude_patterns: set):
        """覆盖目录（只覆盖源中存在的文件，不删除目标中多余的文件）"""
        dst.mkdir(parents=True, exist_ok=True)
        for item in src.iterdir():
            name = item.name
            if name in exclude_patterns:
                continue
            if any(name.endswith(suffix) for suffix in exclude_patterns):
                continue
            dst_item = dst / name
            if item.is_dir():
                self._overlay_directory(item, dst_item, exclude_patterns)
            else:
                shutil.copy2(str(item), str(dst_item))

    def _restore_project(self, backup: Path, target: Path):
        """从备份恢复项目"""
        # 只恢复代码目录，不碰 private/db
        code_dirs = ["public", "server", "tools", "codely_agent"]
        for d in code_dirs:
            src_dir = backup / d
            dst_dir = target / d
            if src_dir.exists():
                if dst_dir.exists():
                    shutil.rmtree(dst_dir, ignore_errors=True)
                shutil.copytree(src_dir, dst_dir)

    def _cleanup_old_backups(self):
        """只保留最近1个备份"""
        backups = sorted(
            [d for d in self.project_root.iterdir()
             if d.is_dir() and d.name.startswith("backup_")],
            key=lambda d: d.name,
            reverse=True
        )
        for old_backup in backups[1:]:
            shutil.rmtree(old_backup, ignore_errors=True)

    def _update_config_version(self):
        config_path = self.project_root / "private" / "config.json"
        if not config_path.exists():
            return
        try:
            with open(config_path, "r", encoding="utf-8-sig") as f:
                config = json.load(f)
            if self._cached_result:
                config["version"] = self._cached_result.get("latest_version", config.get("version", "4.2.0"))
            if "update" not in config:
                config["update"] = {}
            config["update"]["current_version"] = config["version"]
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

# =====================================================================
# 全自动更新守护线程（AutoUpdateDaemon）
# ---------------------------------------------------------------------
# 行为：
#   1. 服务器启动 30 秒后做第一次检查（避开启动高峰）
#   2. 之后每 6 小时复查一次（新版本发布后最多 6 小时内自动到位）
#   3. 发现新版本 -> 静默下载 + 备份 + 覆盖（复用 do_update 全部安全逻辑：
#      版本号比较、全量备份、失败回滚、private/ 排除、备份只保留1个）
#   4. 更新状态写入 self.state，前端通过 /api/update-status 轮询感知，
#      在 AI 空闲时自动刷新页面，全程无需用户任何操作
# 注意：
#   - do_update 覆盖的是代码文件，server/*.py 变化由项目自带的热更新
#     引擎（hot_reload.py）自动重载，无需重启服务器进程
# =====================================================================
class AutoUpdateDaemon:
    """全自动更新守护线程"""

    def __init__(self, checker):
        self.checker = checker
        self.state = {
            "auto_enabled": True,       # 自动更新开关（预留手动关闭入口）
            "phase": "idle",            # idle/checking/downloading/updated/error
            "current_version": None,
            "latest_version": None,
            "message": "",
            "download_url": None,       # 有新版本时的安装包下载地址（供 /api/do-update 使用）
            "updated_at": None,         # 更新完成时间戳（前端据此判断是否刷新页面）
            "error": None,
        }
        self._lock = threading.Lock()
        self._thread = None
        self._stop_event = threading.Event()

    def _set(self, **kw):
        with self._lock:
            self.state.update(kw)

    def get_state(self):
        with self._lock:
            return dict(self.state)

    # ---- 主循环 ----
    def _run(self):
        # 首次延迟 30 秒，避开服务器启动高峰
        if self._stop_event.wait(30):
            return
        while not self._stop_event.is_set():
            try:
                self._check_and_apply()
            except Exception as e:
                self._set(phase="error", error=str(e))
                print(f"[auto-update] 守护线程异常: {e}")
            # 每 6 小时检查一次（可被停止事件提前唤醒）
            self._stop_event.wait(6 * 3600)

    def _check_and_apply(self):
        self._set(phase="checking", error=None)
        result = self.checker.check_update()
        current = result.get("current_version", "?")
        latest = result.get("latest_version", "")
        self._set(current_version=current, latest_version=latest or None)

        if not result.get("has_update"):
            self._set(phase="idle", message=result.get("message", "已是最新版本"))
            return

        # 方案B：不自动应用，只标记"有新版本可用"，由用户点击后下载安装包
        print(f"[auto-update] 发现新版本 {latest}（当前 {current}），等待用户确认更新")
        self._set(
            phase="available",
            latest_version=latest,
            download_url=result.get("download_url", ""),
            message=f"发现新版本 {latest}，等待用户更新",
        )

    # ---- 生命周期 ----
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="zf3d-auto-update", daemon=True)
        self._thread.start()
        try:
            from config import QUIET_CONSOLE
        except Exception:
            QUIET_CONSOLE = True
        if not QUIET_CONSOLE:
            print("[auto-update] 全自动更新守护线程已启动（首查延迟30秒，每6小时复查）")


# 模块级单例（首次调用时创建）
_daemon = None
_daemon_lock = threading.Lock()


def get_update_checker(config: dict = None):
    """创建 UpdateChecker 实例（自动加载 private/config.json，无则用默认配置）

    与 handler_routes.py 中 /api/check-update 的构造方式保持一致。
    """
    if config is None:
        cfg_path = Path(__file__).resolve().parent.parent / "private" / "config.json"
        config = {}
        if cfg_path.exists():
            try:
                config = json.loads(cfg_path.read_text(encoding="utf-8"))
            except Exception:
                config = {}
    return UpdateChecker(config)


def start_auto_update():
    """启动全自动更新守护线程（幂等，可重复调用）"""
    global _daemon
    with _daemon_lock:
        if _daemon is None:
            _daemon = AutoUpdateDaemon(get_update_checker())
        _daemon.start()
        return _daemon.get_state()


def get_auto_update_state():
    """获取自动更新状态（供 /api/update-status 路由使用）"""
    with _daemon_lock:
        if _daemon is None:
            return {"auto_enabled": True, "phase": "idle", "message": "守护线程未启动"}
        return _daemon.get_state()
