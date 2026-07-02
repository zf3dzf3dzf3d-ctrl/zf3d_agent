#!/bin/bash
# ============================================
# 朱峰社区智能体 (ZF3D Agent) - Linux 一键安装
# 用法: bash install.sh
# ============================================
set -e

# 颜色输出
红='\033[0;31m'
绿='\033[0;32m'
蓝='\033[0;34m'
黄='\033[0;33m'
无色='\033[0m'

echo -e "${蓝}================================================${无色}"
echo -e "${蓝}  朱峰社区智能体 (ZF3D Agent) - 安装程序${无色}"
echo -e "${蓝}================================================${无色}"

# ---------- 1. 检查 Python3 ----------
echo -e "\n${黄}[1/5] 检查 Python3...${无色}"
if command -v python3 &>/dev/null; then
    PY_VER=$(python3 --version 2>&1)
    echo -e "  ${绿}✅ ${PY_VER}${无色}"
else
    echo -e "  ${红}❌ 未找到 python3${无色}"
    echo -e "  ${黄}请安装 Python 3.8+:${无色}"
    echo -e "  ${蓝}  Ubuntu/Debian:  sudo apt install python3${无色}"
    echo -e "  ${蓝}  CentOS/Fedora:  sudo dnf install python3${无色}"
    echo -e "  ${蓝}  Arch:           sudo pacman -S python${无色}"
    exit 1
fi

# ---------- 2. 选择安装方式 ----------
echo -e "\n${黄}[2/5] 选择安装方式...${无色}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/公共区/内核/启动器.py" ]; then
    # 本地解压包安装
    INSTALL_DIR="$SCRIPT_DIR"
    echo -e "  ${绿}✅ 检测到本地安装包，安装到当前目录${无色}"
    echo -e "  ${蓝}  路径: ${INSTALL_DIR}${无色}"
else
    # 从Git clone安装
    INSTALL_DIR="$HOME/zf3d_agent"
    echo -e "  ${蓝}从Git仓库克隆到 ${INSTALL_DIR}${无色}"
    echo -e "  ${黄}  选择镜像:${无色}"
    echo -e "    1) Gitee (国内推荐)"
    echo -e "    2) GitHub (国际)"
    read -p "  请选择 [1]: " MIRROR_CHOICE
    MIRROR_CHOICE=${MIRROR_CHOICE:-1}

    if [ "$MIRROR_CHOICE" = "1" ]; then
        REPO_URL="https://gitee.com/zf3d/zf3d_agent.git"
    else
        REPO_URL="https://github.com/zf3dzf3dzf3d-ctrl/zf3d_agent.git"
    fi

    if [ -d "$INSTALL_DIR" ]; then
        echo -e "  ${黄}目录已存在，更新代码...${无色}"
        cd "$INSTALL_DIR"
        git pull
    else
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
fi

cd "$INSTALL_DIR"

# ---------- 3. 创建隐私区目录结构 ----------
echo -e "\n${黄}[3/5] 创建隐私区目录...${无色}"
mkdir -p 隐私区/我的配置
mkdir -p 隐私区/我的记忆
mkdir -p 隐私区/我的数据
mkdir -p 隐私区/我的日志
mkdir -p 隐私区/对话记录
mkdir -p 隐私区/浏览器会话
mkdir -p 隐私区/我的剧本
mkdir -p 隐私区/我的知识库
mkdir -p 隐私区/我的工作引擎
echo -e "  ${绿}✅ 隐私区目录就绪${无色}"

# ---------- 4. 初始化密钥配置 ----------
echo -e "\n${黄}[4/5] 初始化密钥配置...${无色}"
KEY_FILE="隐私区/我的配置/密钥.json"
if [ ! -f "$KEY_FILE" ]; then
    if [ -f "隐私区/我的配置/密钥_模板.json" ]; then
        cp 隐私区/我的配置/密钥_模板.json "$KEY_FILE"
        echo -e "  ${绿}✅ 已从模板创建 密钥.json${无色}"
    else
        echo -e "  ${黄}⚠️  未找到密钥模板，请手动创建${无色}"
    fi
else
    echo -e "  ${绿}✅ 密钥.json 已存在${无色}"
fi

echo -e "  ${黄}请编辑 隐私区/我的配置/密钥.json 填入你的API Key${无色}"

# ---------- 5. 创建桌面快捷方式 ----------
echo -e "\n${黄}[5/5] 创建桌面快捷方式...${无色}"
DESKTOP_FILE="$HOME/.local/share/applications/zf3d-agent.desktop"
mkdir -p "$(dirname "$DESKTOP_FILE")"

cat > "$DESKTOP_FILE" << DESKTOPEOF
[Desktop Entry]
Name=朱峰社区智能体
Comment=ZF3D Agent - AI桌面助手
Exec=bash -c 'cd "$INSTALL_DIR" && python3 公共区/内核/启动器.py'
Icon=$INSTALL_DIR/公共区/界面/favicon.png
Terminal=true
Type=Application
Categories=Development;Utility;
DESKTOPEOF

chmod +x "$DESKTOP_FILE"
echo -e "  ${绿}✅ 桌面快捷方式已创建${无色}"
echo -e "  ${蓝}  也可在应用菜单中找到「朱峰社区智能体」${无色}"

# ---------- 完成 ----------
echo -e "\n${绿}================================================${无色}"
echo -e "${绿}  ✅ 安装完成！${无色}"
echo -e "${green}================================================${无色}"
echo -e "\n${蓝}启动方式:${无色}"
echo -e "  ${黄}方式1:${无色} 在应用菜单点击「朱峰社区智能体」"
echo -e "  ${黄}方式2:${无色} 运行 bash 启动.sh"
echo -e "  ${黄}方式3:${无色} 运行 python3 公共区/内核/启动器.py"
echo -e "\n${蓝}首次使用:${无色}"
echo -e "  ${黄}1.${无色} 编辑 隐私区/我的配置/密钥.json 填入API Key"
echo -e "  ${黄}2.${无色} 启动后打开浏览器访问 http://localhost:8765"
echo -e "\n${蓝}更新方式:${无色}"
echo -e "  ${黄}cd ${INSTALL_DIR} && git pull${无色}"
echo ""
