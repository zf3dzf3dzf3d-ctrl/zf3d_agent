"""Houdini Bridge 自动安装器

自动检测 Houdini 安装路径和用户配置目录，将 Bridge Server 安装到 pythonrc.py。

用法：
    python 安装Houdini桥接.py          # 安装
    python 安装Houdini桥接.py 卸载      # 卸载
"""
import os
import sys
import json
import shutil
from pathlib import Path

# ============================================================
# 路径常量
# ============================================================
_HERE = Path(__file__).parent.resolve()
_BRIDGE_SOURCE = _HERE / "Houdini" / "bridge_server_for_houdini.py"
_BRIDGE_MARKER = "# ===== Houdini Bridge Server (zf3d_Agent) ====="
_BRIDGE_END = "# ===== Houdini Bridge Server END ====="


def _find_houdini_versions():
    """检测所有已安装的 Houdini 版本"""
    versions = []

    # 1. 从注册表查找
    try:
        import winreg
        for hive in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_LOCAL_MACHINE | winreg.KEY_WOW64_32KEY]:
            try:
                key = winreg.OpenKey(hive, r"SOFTWARE\Side Effects Software")
                i = 0
                while True:
                    try:
                        subkey_name = winreg.EnumKey(key, i)
                        i += 1
                        if subkey_name.startswith("Houdini"):
                            try:
                                subkey = winreg.OpenKey(key, subkey_name)
                                install_path = winreg.QueryValueEx(subkey, "InstallPath")[0]
                                versions.append({"version": subkey_name, "path": install_path})
                                winreg.CloseKey(subkey)
                            except (FileNotFoundError, OSError):
                                pass
                    except OSError:
                        break
                winreg.CloseKey(key)
            except (FileNotFoundError, OSError):
                pass
    except ImportError:
        pass

    # 2. 从文件系统查找
    for drive in ["C:\\", "D:\\", "E:\\"]:
        base = Path(drive, "Program Files", "Side Effects Software")
        if base.exists():
            for d in base.iterdir():
                if d.name.startswith("Houdini") and d.is_dir():
                    exe = d / "bin" / "houdini.exe"
                    if exe.exists() or (d / "bin").exists():
                        # 避免重复
                        if not any(v["version"] == d.name for v in versions):
                            versions.append({"version": d.name, "path": str(d)})

    return versions


def _get_user_houdini_dir(version_str):
    """获取用户 Houdini 配置目录

    Houdini 20.5 → ~/Documents/houdini20.5/
    """
    # 提取主版本号.次版本号
    parts = version_str.replace("Houdini", "").strip().split(".")
    if len(parts) >= 2:
        major_minor = f"{parts[0]}.{parts[1]}"
    else:
        major_minor = parts[0]

    docs = Path.home() / "Documents"
    return docs / f"houdini{major_minor}", major_minor


def _read_bridge_code():
    """读取 bridge server 源码"""
    if not _BRIDGE_SOURCE.exists():
        print(f"❌ 找不到 Bridge 源码: {_BRIDGE_SOURCE}")
        return None
    return _BRIDGE_SOURCE.read_text(encoding="utf-8")


def _is_bridge_installed(pythonrc_path):
    """检测 bridge 是否已安装到 pythonrc.py"""
    if not pythonrc_path.exists():
        return False
    content = pythonrc_path.read_text(encoding="utf-8", errors="ignore")
    return _BRIDGE_MARKER in content


def _install_to_file(pythonrc_path):
    """将 bridge 代码安装到 pythonrc.py（追加模式）"""
    bridge_code = _read_bridge_code()
    if bridge_code is None:
        return False

    # 包装成可识别的块
    block = f"\n\n{_BRIDGE_MARKER}\n"
    block += f"# 自动安装于 {os.path.basename(str(Path.home()))} 的 zf3d_Agent\n"
    block += f"# 源码位置: {_HERE / 'Houdini' / 'bridge_server_for_houdini.py'}\n"
    block += f"# 卸载方法: python 安装Houdini桥接.py 卸载\n"
    block += bridge_code
    block += f"\n{_BRIDGE_END}\n"

    # 如果文件不存在，创建
    if not pythonrc_path.exists():
        pythonrc_path.parent.mkdir(parents=True, exist_ok=True)
        pythonrc_path.write_text(block, encoding="utf-8")
        return True

    # 已存在，检查是否已安装
    existing = pythonrc_path.read_text(encoding="utf-8", errors="ignore")
    if _BRIDGE_MARKER in existing:
        # 替换旧块
        start = existing.find(_BRIDGE_MARKER)
        end = existing.find(_BRIDGE_END)
        if end != -1:
            end += len(_BRIDGE_END) + 1
            existing = existing[:start] + block + existing[end:]
        else:
            existing += block
        pythonrc_path.write_text(existing, encoding="utf-8")
    else:
        # 追加
        pythonrc_path.write_text(existing + block, encoding="utf-8")

    return True


def _uninstall_from_file(pythonrc_path):
    """从 pythonrc.py 中移除 bridge 代码"""
    if not pythonrc_path.exists():
        return False

    content = pythonrc_path.read_text(encoding="utf-8", errors="ignore")
    if _BRIDGE_MARKER not in content:
        return False

    start = content.find(_BRIDGE_MARKER)
    end = content.find(_BRIDGE_END)
    if end != -1:
        end += len(_BRIDGE_END) + 1
    else:
        end = len(content)

    content = content[:start] + content[end:]
    pythonrc_path.write_text(content, encoding="utf-8")
    return True


def _install_package_json(user_dir, version_str):
    """安装 Houdini Package JSON（让 Houdini 自动发现 pythonrc.py）"""
    parts = version_str.replace("Houdini", "").strip().split(".")
    major_minor = f"{parts[0]}.{parts[1]}" if len(parts) >= 2 else parts[0]

    packages_dir = user_dir / "packages"
    packages_dir.mkdir(parents=True, exist_ok=True)

    package_json = packages_dir / "zf3d_bridge.json"
    package_content = {
        "enable": True,
        "env": [
            {"HOUDINI_BRIDGE_PORT": "45172"}
        ]
    }

    package_json.write_text(
        json.dumps(package_content, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )
    return package_json


def _uninstall_package_json(user_dir):
    """移除 Package JSON"""
    package_json = user_dir / "packages" / "zf3d_bridge.json"
    if package_json.exists():
        package_json.unlink()
        return True
    return False


def do_install():
    """执行安装"""
    print("=" * 60)
    print("  Houdini Bridge 自动安装器")
    print("=" * 60)

    # 1. 检测 Houdini
    versions = _find_houdini_versions()
    if not versions:
        print("\n❌ 未检测到 Houdini 安装。请确认 Houdini 已安装。")
        return

    print(f"\n📊 检测到 {len(versions)} 个 Houdini 版本：")
    for i, v in enumerate(versions):
        print(f"  [{i}] {v['version']} — {v['path']}")

    # 如果有多个版本，让用户选择
    if len(versions) > 1:
        try:
            choice = input(f"\n选择要安装的版本 (0-{len(versions)-1})，回车=全部安装: ")
            if choice.strip():
                idx = int(choice)
                versions = [versions[idx]]
        except (ValueError, IndexError):
            pass

    # 2. 逐版本安装
    for v in versions:
        version_str = v["version"]
        install_path = v["path"]
        print(f"\n--- 安装到 {version_str} ---")

        # 用户配置目录
        user_dir, major_minor = _get_user_houdini_dir(version_str)
        print(f"  用户目录: {user_dir}")

        # 检查目录
        if not user_dir.exists():
            print(f"  ℹ️ 目录不存在，创建中: {user_dir}")
            user_dir.mkdir(parents=True, exist_ok=True)

        # pythonrc.py 路径
        pythonrc_path = user_dir / "scripts" / "python" / "pythonrc.py"
        print(f"  目标文件: {pythonrc_path}")

        # 检查是否已安装
        if _is_bridge_installed(pythonrc_path):
            print(f"  ⚠️ Bridge 已安装，将更新...")

        # 安装 bridge
        if _install_to_file(pythonrc_path):
            print(f"  ✅ Bridge Server 已安装到 {pythonrc_path}")
        else:
            print(f"  ❌ 安装失败")
            continue

        # 安装 package JSON
        pkg_path = _install_package_json(user_dir, version_str)
        print(f"  ✅ Package JSON 已安装到 {pkg_path}")

        # 验证
        print(f"\n  📋 安装摘要:")
        print(f"     Houdini: {version_str}")
        print(f"     Bridge:  {pythonrc_path}")
        print(f"     Package: {pkg_path}")
        print(f"     端口:    45172")

    print(f"\n{'=' * 60}")
    print("  ✅ 安装完成！")
    print("=" * 60)
    print("\n下一步：")
    print("  1. 启动 Houdini")
    print("  2. 在控制台应该看到: [Houdini Bridge] 监听 127.0.0.1:45172")
    print("  3. 在智能体中说「检测 Houdini 连接」")
    print()


def do_uninstall():
    """执行卸载"""
    print("=" * 60)
    print("  Houdini Bridge 卸载")
    print("=" * 60)

    versions = _find_houdini_versions()
    if not versions:
        print("\n❌ 未检测到 Houdini 安装。")
        return

    removed = 0
    for v in versions:
        version_str = v["version"]
        user_dir, _ = _get_user_houdini_dir(version_str)
        pythonrc_path = user_dir / "scripts" / "python" / "pythonrc.py"

        if _is_bridge_installed(pythonrc_path):
            _uninstall_from_file(pythonrc_path)
            print(f"  ✅ 从 {version_str} 移除 Bridge: {pythonrc_path}")
            removed += 1
        else:
            print(f"  ℹ️ {version_str} 未安装 Bridge")

        if _uninstall_package_json(user_dir):
            print(f"  ✅ 移除 Package JSON: {user_dir / 'packages' / 'zf3d_bridge.json'}")

    print(f"\n{'=' * 60}")
    print(f"  卸载完成，共移除 {removed} 个安装。" if removed else "  没有需要卸载的安装。")
    print("=" * 60)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "卸载":
        do_uninstall()
    else:
        do_install()
