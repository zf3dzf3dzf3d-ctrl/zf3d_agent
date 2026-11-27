; ============================================================
; 安装包中文模板 template.iss（UTF-8 with BOM）
; 使用方法：复制本文件为 <产品名>.iss → 改 【】内参数 → 跑
;   python tools/installer/check_installer.py <脚本>.iss
; 自检退出码 0 后才允许编译。
; 编译器：Inno Setup 6.x Unicode 版（禁用旧版 ANSI 版）
; ============================================================

[Setup]
AppName=【产品名】
AppVersion=【版本号，如 6.0.0】
DefaultDirName={autopf}\【产品目录名，纯英文】
DefaultGroupName=【产品名】
OutputDir=output
OutputBaseFilename=【安装包文件名，纯英文】
; UTF-8 脚本必须显式声明（Inno 6 默认支持，写明防漂移）
; ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
; 中文语言段——三根因之二，缺此段即正文乱码
Name: "chs"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Files]
; 示例：把待安装文件放这里；引入的 .txt/.rtf 资源必须 UTF-8 编码
; Source: "dist\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
Name: "{group}\【产品名】"; Filename: "{app}\【主程序.exe】"
