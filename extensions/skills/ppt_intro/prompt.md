# PPT 介绍稿生成技能

目标：为用户生成一个成品 .pptx 文件（不是大纲），风格与之前「朱峰社区智能体无限 5.0.5 介绍」保持一致。

## 固定风格（不要改动，除非用户明确要求）
- 尺寸：16:9 宽屏（10 x 5.625 英寸）
- 主题色：深蓝 #1F4E79（标题栏/封面底色），白色文字，浅灰 #F2F2F2 背景
- 字体：微软雅黑，标题 28-32pt，正文 14-16pt
- 每页顶部蓝色标题条，内容用要点式短句，不写长段落

## 页面结构模板（按需增减，默认 6~8 页）
1. 封面：产品/版本名 + 一句话口号
2. 亮点总览：3~4 条核心改进
3~N. 每个改进一页：是什么 → 为什么 → 效果/数据
倒数第 2 页：升级/使用须知（免费、注意事项）
最后一页：谢谢观看

## 生成方式（必须真实生成文件）
1. 确保依赖：在临时目录 `C:\Users\Administrator\AppData\Local\Temp\pptgen` 下 `npm init -y && npm install pptxgenjs`（已装过可跳过）。
2. 用 Node 写脚本生成，模板开头：
   ```js
   const pptxgen = require("pptxgenjs");
   const pres = new pptxgen();
   pres.defineLayout({ name: "W16x9", width: 10, height: 5.625 });
   pres.layout = "W16x9";
   // 封面示例
   let s = pres.addSlide();
   s.background = { color: "1F4E79" };
   s.addText("标题", { x: 0.5, y: 2, w: 9, h: 1, fontSize: 36, bold: true, color: "FFFFFF", fontFace: "微软雅黑", align: "center" });
   // 内容页标题条
   // s.background = { color: "F2F2F2" }; s.addShape("rect", {x:0,y:0,w:10,h:0.9,fill:{color:"1F4E79"}}); ...
   pres.writeFile({ fileName: "输出路径.pptx" }).then(f => console.log("OK:", f));
   ```
3. 脚本写到 Temp 后执行 node 运行，输出文件放在项目根目录（或用户指定的位置），文件名形如「XX介绍.pptx」。
4. 运行成功后验证文件确实存在（dir 检查），再向用户汇报页数结构和路径。

## 内容要求
- 内容优先来自：当前项目 README / 项目记录 / 用户口述，如实描述，不编造数据。
- 若用户没给具体内容，先列出大纲要点让用户确认或补充，再生成。
