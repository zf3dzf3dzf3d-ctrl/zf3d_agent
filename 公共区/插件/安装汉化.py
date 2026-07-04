"""Houdini 20.5 中文汉化自动安装器（朱峰社区版）

用法：
    python 安装汉化.py          # 安装汉化
    python 安装汉化.py 卸载      # 卸载汉化（恢复英文原版）
    python 安装汉化.py 状态      # 检查汉化安装状态

原理：
    1. 备份用户文档目录中的原始文件（首次安装时）
    2. 将汉化包内容复制到 ~/Documents/houdini20.5/
    3. Houdini 启动时自动加载中文界面和节点翻译

汉化包来源：朱峰社区 https://www.zf3d.com
"""
import os
import sys
import shutil
import json
from pathlib import Path


# ============================================================
# 路径常量
# ============================================================
_HERE = Path(__file__).parent.resolve()

# 汉化包源目录（相对安装器位置自动查找）
def _find_huahua_dir():
    """查找汉化包目录"""
    # 1. 安装器同目录下的 "汉化包" 文件夹
    candidates = [
        _HERE / "汉化包",
        _HERE / "Houdini20.5中文汉化正式版(朱峰社区)",
        _HERE / "Houdini20.5中文汉化正式版",
    ]
    for c in candidates:
        if c.exists():
            # 找到内部的 "复制到你的文档houdini20里" 子目录
            sub = c / "复制到你的文档houdini20里"
            if sub.exists():
                return sub
            return c

    # 2. 用户文档目录中查找
    docs = Path.home() / "Documents"
    if docs.exists():
        for d in docs.iterdir():
            if "汉化" in d.name and "Houdini" in d.name:
                sub = d / "复制到你的文档houdini20里"
                if sub.exists():
                    return sub
                return d

    # 3. 在 Houdini 用户目录中查找
    for ver in ["20.5", "20.0", "19.5"]:
        hu = Path.home() / "Documents" / f"houdini{ver}"
        if hu.exists():
            for d in hu.iterdir():
                if "汉化" in d.name and "Houdini" in d.name:
                    sub = d / "复制到你的文档houdini20里"
                    if sub.exists():
                        return sub
                    return d
    return None


def _get_houdini_user_dir():
    """获取 Houdini 用户配置目录"""
    docs = Path.home() / "Documents"
    # 优先查找 20.5
    for ver in ["20.5", "20.0", "19.5"]:
        d = docs / f"houdini{ver}"
        if d.exists():
            return d, ver
    # 没找到已有目录，用 20.5
    return docs / "houdini20.5", "20.5"


def _get_backup_dir(user_dir):
    """获取备份目录路径"""
    return user_dir.parent / f"houdini{user_dir.name.replace('houdini', '')}_英文原版备份"


def _count_files(path):
    """统计目录下文件数"""
    count = 0
    for root, dirs, files in os.walk(path):
        count += len(files)
    return count


# ============================================================
# 安装
# ============================================================
def do_install():
    """安装汉化"""
    print("=" * 60)
    print("  Houdini 中文汉化自动安装器")
    print("  汉化来源：朱峰社区 https://www.zf3d.com")
    print("=" * 60)

    # 1. 查找汉化包
    hua_dir = _find_huahua_dir()
    if not hua_dir:
        print("\n❌ 未找到汉化包目录！")
        print("   请将汉化包放在以下位置之一：")
        print(f"   a) {_HERE / '汉化包'}")
        print(f"   b) {_HERE / 'Houdini20.5中文汉化正式版(朱峰社区)'}")
        print(f"   c) ~/Documents/Houdini20.5中文汉化正式版(朱峰社区)/")
        return False

    print(f"\n📁 汉化包路径: {hua_dir}")
    file_count = _count_files(hua_dir)
    print(f"📊 汉化文件数: {file_count}")

    # 2. 获取 Houdini 用户目录
    user_dir, version = _get_houdini_user_dir()
    print(f"📁 用户目录:   {user_dir}")
    print(f"📊 Houdini 版本: {version}")

    # 3. 确认
    print(f"\n⚠️  即将把汉化文件复制到: {user_dir}")
    print(f"    首次安装会自动备份原始文件到: {_get_backup_dir(user_dir)}")
    try:
        ans = input("\n继续安装？(y/n): ").strip().lower()
        if ans not in ("y", "yes", ""):
            print("已取消。")
            return False
    except EOFError:
        pass

    # 4. 首次备份
    backup_dir = _get_backup_dir(user_dir)
    if not backup_dir.exists():
        if user_dir.exists():
            print(f"\n📦 首次安装，备份英文原版到: {backup_dir}")
            try:
                shutil.copytree(str(user_dir), str(backup_dir))
                print(f"   ✅ 备份完成")
            except Exception as e:
                print(f"   ❌ 备份失败: {e}")
                print(f"   请手动备份 {user_dir} 后重试")
                return False
        else:
            print(f"\nℹ️  用户目录不存在，创建: {user_dir}")
            user_dir.mkdir(parents=True, exist_ok=True)
            # 创建空备份目录标记
            backup_dir.mkdir(parents=True, exist_ok=True)
    else:
        print(f"\nℹ️  备份已存在: {backup_dir}（跳过备份）")

    # 5. 确保用户目录存在
    user_dir.mkdir(parents=True, exist_ok=True)

    # 6. 复制汉化文件
    print(f"\n📋 复制汉化文件...")
    copied = 0
    skipped = 0
    errors = 0

    for item in hua_dir.iterdir():
        dest = user_dir / item.name
        try:
            if item.is_dir():
                # 目录：合并复制（不删除已有内容）
                if dest.exists():
                    # 递归复制目录内容
                    for root, dirs, files in os.walk(str(item)):
                        rel = Path(root).relative_to(item)
                        target_dir = dest / rel
                        target_dir.mkdir(parents=True, exist_ok=True)
                        for f in files:
                            src_file = Path(root) / f
                            dst_file = target_dir / f
                            shutil.copy2(str(src_file), str(dst_file))
                            copied += 1
                else:
                    shutil.copytree(str(item), str(dest))
                    sub_count = _count_files(dest)
                    copied += sub_count
            else:
                # 文件：直接复制覆盖
                shutil.copy2(str(item), str(dest))
                copied += 1
        except PermissionError as e:
            print(f"   ⚠️ 权限不足: {item.name}（可能被 Houdini 占用）")
            errors += 1
        except Exception as e:
            print(f"   ❌ {item.name}: {e}")
            errors += 1

    print(f"\n{'=' * 60}")
    print(f"  ✅ 安装完成！")
    print(f"  复制 {copied} 个文件，{errors} 个错误")
    print(f"{'=' * 60}")
    print(f"\n📋 安装摘要:")
    print(f"  汉化包: {hua_dir}")
    print(f"  目标:   {user_dir}")
    print(f"  备份:   {backup_dir}")
    print(f"\n下一步：")
    print(f"  1. 启动 Houdini {version}")
    print(f"  2. 界面和节点参数应显示中文")
    print(f"  3. 如需恢复英文：python 安装汉化.py 卸载")
    print()
    return True


# ============================================================
# 卸载
# ============================================================
def do_uninstall():
    """卸载汉化（从备份恢复）"""
    print("=" * 60)
    print("  Houdini 中文汉化卸载（恢复英文原版）")
    print("=" * 60)

    user_dir, version = _get_houdini_user_dir()
    backup_dir = _get_backup_dir(user_dir)

    if not backup_dir.exists():
        print(f"\n❌ 未找到英文原版备份: {backup_dir}")
        print(f"   无法自动恢复。请手动重装 Houdini 或手动删除汉化文件。")
        return False

    print(f"\n📁 用户目录: {user_dir}")
    print(f"📁 备份目录: {backup_dir}")

    try:
        ans = input("\n确认恢复英文原版？当前用户目录会被备份覆盖 (y/n): ").strip().lower()
        if ans not in ("y", "yes", ""):
            print("已取消。")
            return False
    except EOFError:
        pass

    # 删除当前用户目录内容，从备份恢复
    print(f"\n🗑️  清理当前汉化文件...")
    try:
        for item in user_dir.iterdir():
            if item.is_dir():
                shutil.rmtree(str(item))
            else:
                item.unlink()
    except Exception as e:
        print(f"   ⚠️ 清理失败: {e}")

    print(f"📦 从备份恢复英文原版...")
    try:
        for item in backup_dir.iterdir():
            dest = user_dir / item.name
            if item.is_dir():
                shutil.copytree(str(item), str(dest))
            else:
                shutil.copy2(str(item), str(dest))
    except Exception as e:
        print(f"   ❌ 恢复失败: {e}")
        return False

    print(f"\n{'=' * 60}")
    print(f"  ✅ 已恢复英文原版")
    print(f"{'=' * 60}")
    print(f"  重启 Houdini 即可使用英文界面。")
    print()
    return True


# ============================================================
# 状态检查
# ============================================================
def do_status():
    """检查汉化状态"""
    print("=" * 60)
    print("  Houdini 汉化状态检查")
    print("=" * 60)

    user_dir, version = _get_houdini_user_dir()
    backup_dir = _get_backup_dir(user_dir)
    hua_dir = _find_huahua_dir()

    print(f"\n📁 Houdini 用户目录: {user_dir} ({'存在' if user_dir.exists() else '不存在'})")
    print(f"📊 Houdini 版本: {version}")
    print(f"📦 英文备份: {backup_dir} ({'已备份' if backup_dir.exists() else '未备份'})")
    print(f"📋 汉化包: {hua_dir} ({'已找到' if hua_dir else '未找到'})")

    # 检查是否已安装汉化
    if user_dir.exists():
        dialogs = user_dir / "config" / "Dialogs"
        if dialogs.exists():
            # 检查是否有中文标签
            has_chinese = False
            for root, dirs, files in os.walk(str(dialogs)):
                for f in files:
                    try:
                        filepath = Path(root) / f
                        content = filepath.read_text(encoding="utf-8", errors="ignore")
                        if any('\u4e00' <= c <= '\u9fff' for c in content[:500]):
                            has_chinese = True
                            break
                    except Exception:
                        pass
                if has_chinese:
                    break
            if has_chinese:
                print(f"\n✅ 汉化已安装（检测到中文 Dialog 文件）")
            else:
                print(f"\n❌ 汉化未安装（未检测到中文内容）")
        else:
            print(f"\n❌ 汉化未安装（无 Dialogs 目录）")
    else:
        print(f"\n❌ 用户目录不存在")

    if hua_dir:
        file_count = _count_files(hua_dir)
        print(f"\n📋 汉化包统计: {file_count} 个文件")
    print()


# ============================================================
# 主入口
# ============================================================
if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "卸载" or cmd == "uninstall":
            do_uninstall()
        elif cmd == "状态" or cmd == "status":
            do_status()
        elif cmd == "安装" or cmd == "install":
            do_install()
        else:
            print(f"未知命令: {cmd}")
            print("用法: python 安装汉化.py [安装|卸载|状态]")
    else:
        do_install()
