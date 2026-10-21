const fs = require('fs');
let c = fs.readFileSync('C:/work/web/caizhi_fenlei.asp', 'utf8');

// Fix escaped backslash-quotes from PowerShell insertion
c = c.replace(/class=\\"/g, 'class="');
c = c.replace(/href=\\"/g, 'href="');
c = c.replace(/style=\\"/g, 'style="');

// Fix garbled emoji
c = c.replace(/\u9999\u5e3a/g, '\u{1F3A8}'); // 🎨
c = c.replace(/\u9999\u645A/g, '\u{1F4E6}'); // 📦  
c = c.replace(/\u9999\u6182/g, '\u{1F441}'); // 👁

// Fix garbled Chinese text
const rep = {
    '免费': '免费',
    '鐣欒█': '留言',
    '分享': '分享',
    '鐙敭': '独售',
    '鍏?': '共 ',
    '涓粨鏋?': '个结果',
    '涓潗璐?': '个材质',
    '娌℃湁鎵惧埌鐩稿叧鏉愯川': '没有找到相关材质',
    '暂无材质数据': '暂无材质数据',
    '鏉愯川鍗＄墖缃戞牸': '材质卡片网格',
    '材质': '材质',
    'ASP棰勮緭鍑烘暟鎹?': 'ASP预输出数据',
    '3D材质 路 贴图 路 图库 路 效果图?鈥?专业材质资源下载': '3D材质 · 贴图 · 图库 · 效果图 — 专业材质资源下载',
    '材质贴图': '材质贴图',
    '3D材质': '3D材质',
    '贴图': '贴图',
    '图库': '图库',
    '鏁堟灉鍥': '效果图',
    '专业材质资源下载': '专业材质资源下载',
    '鏌ョ湅': '查看',
    '素材': '素材',
    '璐ㄦ簮': '资源',
    '妯″瀷': '模型',
    '杞欢': '软件',
    '杞浇': '转载',
    '杞浇鏁欑▼': '转载教程',
    '3D鏁欑▼': '3D教程',
    '澶х被': '大类',
    '子类': '子类',
    '鍏蜂綋杞欢': '具体软件',
    'hover鏄剧ず': 'hover显示',
    '绛涢€夋爮': '筛选栏',
    '搜索': '搜索',
    '鍒嗛〉': '分页'
};

for (const [k, v] of Object.entries(rep)) {
    c = c.split(k).join(v);
}

fs.writeFileSync('C:/work/web/caizhi_fenlei.asp', c, 'utf8');
console.log('Done');
