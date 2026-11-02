# -*- coding: utf-8 -*-
"""动物/角色专属手绘图标：每个都有独特轮廓特征，替换 extra3 中通用 face() 模板。
风格：扁平彩色 + 深色描边细节，24x24 viewBox，识别度优先。
"""

AVATAR_SPEC = {}

def _reg(ch, body):
    AVATAR_SPEC[ch] = body

# --- 耳朵/轮廓辅助 ---
def _earround(cx, cy, r, fill):
    return '<circle cx="%s" cy="%s" r="%s" fill="%s"/>' % (cx, cy, r, fill)

# 🐶 狗：垂耳 + 吐舌
_reg('🐶',
    '<path d="M5.5 5c-2 0-3 3-2.5 6s2 4.5 3.5 3.5z" fill="#8D6E63"/>'
    '<path d="M18.5 5c2 0 3 3 2.5 6s-2 4.5-3.5 3.5z" fill="#8D6E63"/>'
    '<circle cx="12" cy="13" r="8" fill="#FFB74D"/>'
    '<path d="M6 10c1.5-2 4-2.5 5.5-1.5M12.5 8.5C14 7.5 16.5 8 18 10" fill="none" stroke="#E0A050" stroke-width="1.4" stroke-linecap="round"/>'
    '<circle cx="9" cy="12" r="1.2" fill="#37474F"/><circle cx="15" cy="12" r="1.2" fill="#37474F"/>'
    '<ellipse cx="12" cy="15.5" rx="1.6" ry="1.2" fill="#4E342E"/>'
    '<path d="M12 16.5v1.5a2 2 0 004 0v-1" fill="#EF5350"/>')

# 🐱 猫：三角耳 + 胡须
_reg('🐱',
    '<path d="M5 9L4 3.5l4.5 2.6zM19 9l1-5.5-4.5 2.6z" fill="#FFB300"/>'
    '<circle cx="12" cy="13" r="8" fill="#FFCA28"/>'
    '<circle cx="9" cy="12" r="1.2" fill="#37474F"/><circle cx="15" cy="12" r="1.2" fill="#37474F"/>'
    '<path d="M10.8 14.6h2.4L12 16.2z" fill="#EF6C00"/>'
    '<g stroke="#FB8C00" stroke-width="1" stroke-linecap="round">'
    '<path d="M4.5 13h3M4.8 15.5l2.8-.8M19.5 13h-3M19.2 15.5l-2.8-.8"/></g>')

# 🦊 狐狸：大白脸颊尖下巴 + 尖耳
_reg('🦊',
    '<path d="M5 9.5L3.8 3.8l5 2.4zM19 9.5l1.2-5.7-5 2.4z" fill="#E64A19"/>'
    '<path d="M12 21c-5 0-8.5-3.2-8.5-7.5C3.5 9 7 6.5 12 6.5S20.5 9 20.5 13.5C20.5 17.8 17 21 12 21z" fill="#FF7043"/>'
    '<path d="M12 21c-2.6 0-4.8-1-6.2-2.6 1-2.8 3.4-4.4 6.2-4.4s5.2 1.6 6.2 4.4C16.8 20 14.6 21 12 21z" fill="#FFF3E0"/>'
    '<circle cx="9" cy="12" r="1.2" fill="#37474F"/><circle cx="15" cy="12" r="1.2" fill="#37474F"/>'
    '<path d="M10.7 14.8h2.6L12 16.4z" fill="#37474F"/>')

# 🐼 熊猫：黑白 + 眼斑
_reg('🐼',
    '<circle cx="6" cy="6.5" r="3" fill="#37474F"/><circle cx="18" cy="6.5" r="3" fill="#37474F"/>'
    '<circle cx="12" cy="13" r="8" fill="#FAFAFA" stroke="#CFD8DC" stroke-width=".8"/>'
    '<ellipse cx="8.8" cy="12" rx="2.1" ry="2.6" fill="#37474F" transform="rotate(-15 8.8 12)"/>'
    '<ellipse cx="15.2" cy="12" rx="2.1" ry="2.6" fill="#37474F" transform="rotate(15 15.2 12)"/>'
    '<circle cx="8.8" cy="11.6" r=".7" fill="#fff"/><circle cx="15.2" cy="11.6" r=".7" fill="#fff"/>'
    '<ellipse cx="12" cy="15.8" rx="1.5" ry="1.1" fill="#37474F"/>')

# 🐯 虎：橙黄条纹 + 王字
_reg('🐯',
    '<circle cx="6" cy="6.5" r="2.8" fill="#FF9800"/><circle cx="18" cy="6.5" r="2.8" fill="#FF9800"/>'
    '<circle cx="12" cy="13" r="8" fill="#FFB300"/>'
    '<g stroke="#E65100" stroke-width="1.5" stroke-linecap="round">'
    '<path d="M12 5.5v3M9.8 5.8l.6 2.6M14.2 5.8l-.6 2.6M4.6 10.5l2.6.9M4.8 14l2.4-.4M19.4 10.5l-2.6.9M19.2 14l-2.4-.4"/></g>'
    '<circle cx="9" cy="12" r="1.2" fill="#37474F"/><circle cx="15" cy="12" r="1.2" fill="#37474F"/>'
    '<ellipse cx="12" cy="15.6" rx="1.5" ry="1.1" fill="#37474F"/>')

# 🦁 狮：红棕鬃毛环
_reg('🦁',
    '<circle cx="12" cy="12" r="10" fill="#BF5F2B"/>'
    '<circle cx="12" cy="12" r="7" fill="#FFB74D"/>'
    '<circle cx="9" cy="11" r="1.2" fill="#37474F"/><circle cx="15" cy="11" r="1.2" fill="#37474F"/>'
    '<ellipse cx="12" cy="14.8" rx="1.6" ry="1.2" fill="#6D4C41"/>'
    '<path d="M12 16v1.4M10.5 18.4c.9.9 2.1.9 3 0" fill="none" stroke="#6D4C41" stroke-width="1" stroke-linecap="round"/>')

# 🐸 蛙：绿色宽脸 + 顶置凸眼
_reg('🐸',
    '<circle cx="7.5" cy="6" r="3" fill="#66BB6A"/><circle cx="16.5" cy="6" r="3" fill="#66BB6A"/>'
    '<circle cx="7.5" cy="6" r="1.4" fill="#37474F"/><circle cx="16.5" cy="6" r="1.4" fill="#37474F"/>'
    '<path d="M4 12a8 6.5 0 0116 0 8 6.5 0 01-16 0z" fill="#81C784"/>'
    '<path d="M8 15.5c2.5 1.6 5.5 1.6 8 0" fill="none" stroke="#2E7D32" stroke-width="1.4" stroke-linecap="round"/>'
    '<circle cx="9.5" cy="12" r="1" fill="#1B5E20"/><circle cx="14.5" cy="12" r="1" fill="#1B5E20"/>')

# 🐵 猴：浅褐脸 + 大圆耳
_reg('🐵',
    '<circle cx="4.5" cy="12" r="2.8" fill="#8D6E63"/><circle cx="19.5" cy="12" r="2.8" fill="#8D6E63"/>'
    '<circle cx="12" cy="12.5" r="8" fill="#A1887F"/>'
    '<ellipse cx="12" cy="14" rx="5" ry="4.5" fill="#FFCC80"/>'
    '<circle cx="9.2" cy="10.5" r="1.2" fill="#4E342E"/><circle cx="14.8" cy="10.5" r="1.2" fill="#4E342E"/>'
    '<ellipse cx="12" cy="14.2" rx="1.4" ry="1" fill="#6D4C41"/>'
    '<path d="M10.4 16.6c.9.8 2.3.8 3.2 0" fill="none" stroke="#6D4C41" stroke-width="1" stroke-linecap="round"/>')

# 🐔 鸡：红鸡冠 + 黄喙 + 肉垂
_reg('🐔',
    '<path d="M8 5.5c-.5-2 2-3 3-1.5 1-1.5 3.5-.5 3 1.5z" fill="#E53935"/>'
    '<circle cx="12" cy="13" r="8" fill="#FFF3E0"/>'
    '<circle cx="9" cy="11.5" r="1.2" fill="#37474F"/><circle cx="15" cy="11.5" r="1.2" fill="#37474F"/>'
    '<path d="M10.5 14.5h3l-1.5 2.2z" fill="#FFB300"/>'
    '<path d="M12 16.7v1.6a1.5 1.5 0 01-3 0" fill="none" stroke="#E53935" stroke-width="1.6" stroke-linecap="round"/>')

# 🦉 猫头鹰：角羽 + 大圆眼盘
_reg('🦉',
    '<path d="M4.5 8L3 4l4 1.8zM19.5 8L21 4l-4 1.8z" fill="#8D6E63"/>'
    '<ellipse cx="12" cy="13" rx="8.5" ry="8.8" fill="#A1887F"/>'
    '<circle cx="8.7" cy="12" r="3" fill="#FFF8E1"/><circle cx="15.3" cy="12" r="3" fill="#FFF8E1"/>'
    '<circle cx="8.7" cy="12" r="1.4" fill="#37474F"/><circle cx="15.3" cy="12" r="1.4" fill="#37474F"/>'
    '<path d="M10.8 15.5h2.4L12 17.6z" fill="#FFB300"/>'
    '<path d="M8 19.5c2.5-1.2 5.5-1.2 8 0" fill="none" stroke="#8D6E63" stroke-width="1.2"/>')

# 🐺 狼：灰蓝 + 尖立耳 + 锐利眼
_reg('🐺',
    '<path d="M5 9.5L4 3.5l4.5 2.5zM19 9.5l1-6-4.5 2.5z" fill="#78909C"/>'
    '<circle cx="12" cy="13" r="8" fill="#90A4AE"/>'
    '<path d="M12 21c-2.8 0-5-1.2-6.3-3 1-2.4 3.4-3.8 6.3-3.8s5.3 1.4 6.3 3.8c-1.3 1.8-3.5 3-6.3 3z" fill="#ECEFF1"/>'
    '<path d="M7.2 11.2l3-.8M16.8 11.2l-3-.8" stroke="#37474F" stroke-width="1.2" stroke-linecap="round"/>'
    '<circle cx="9.2" cy="12" r="1.1" fill="#FFC107"/><circle cx="14.8" cy="12" r="1.1" fill="#FFC107"/>'
    '<path d="M10.8 15h2.4L12 16.4z" fill="#37474F"/>')

# 🐴 马：长脸 + 立鬃毛
_reg('🐴',
    '<path d="M6 4c3-1.5 7-1.5 10 .5l-2 3.5H7z" fill="#6D4C41"/>'
    '<ellipse cx="12.5" cy="13.5" rx="7.5" ry="8" fill="#8D6E63"/>'
    '<path d="M12.5 6.5c3.5 1 5.5 3.5 5.8 6.5l-2.3.8z" fill="#5D4037"/>'
    '<ellipse cx="10.5" cy="13" rx="3.4" ry="4" fill="#D7CCC8"/>'
    '<circle cx="10" cy="11.5" r="1.2" fill="#37474F"/><circle cx="15.5" cy="11.5" r="1.2" fill="#37474F"/>'
    '<ellipse cx="11.5" cy="16" rx="1.5" ry="1" fill="#4E342E"/>')

# 🦄 独角兽：白脸 + 彩色螺旋角 + 彩鬃
_reg('🦄',
    '<path d="M12 2.2l1.6 4.6h-3.2z" fill="#FFD54F"/>'
    '<path d="M12 3v3.4" stroke="#FF8F00" stroke-width=".7"/>'
    '<path d="M4 10c2-2 5-3 8-3s6 1 8 3l-3 3H7z" fill="#F48FB1"/>'
    '<circle cx="12" cy="14" r="7.5" fill="#FAFAFA" stroke="#E0E0E0" stroke-width=".8"/>'
    '<circle cx="9" cy="13" r="1.2" fill="#5E35B1"/><circle cx="15" cy="13" r="1.2" fill="#5E35B1"/>'
    '<ellipse cx="12" cy="16.4" rx="1.4" ry="1" fill="#EC407A"/>')

# 🐷 猪：粉 + 猪鼻孔
_reg('🐷',
    '<path d="M6.5 5.5a2.6 2.6 0 014-2l1.5 1.2 1.5-1.2a2.6 2.6 0 014 2z" fill="#F48FB1"/>'
    '<circle cx="12" cy="13" r="8" fill="#F8BBD0"/>'
    '<circle cx="8.8" cy="11.5" r="1.2" fill="#37474F"/><circle cx="15.2" cy="11.5" r="1.2" fill="#37474F"/>'
    '<ellipse cx="12" cy="15.8" rx="3.4" ry="2.4" fill="#EC407A"/>'
    '<circle cx="10.8" cy="15.8" r=".7" fill="#AD1457"/><circle cx="13.2" cy="15.8" r=".7" fill="#AD1457"/>')

# 🐮 牛：白脸 + 浅褐斑 + 角
_reg('🐮',
    '<path d="M5 5a3 3 0 013.5-.8M19 5a3 3 0 00-3.5-.8" fill="none" stroke="#D7CCC8" stroke-width="2" stroke-linecap="round"/>'
    '<path d="M6.8 4.8C5 5.5 4 7.5 4 9.5l3.5 1.5zM17.2 4.8C19 5.5 20 7.5 20 9.5l-3.5 1.5z" fill="#F5F5F5"/>'
    '<circle cx="12" cy="13" r="8" fill="#EFEBE9"/>'
    '<path d="M5 9c1.5-1.8 3.5-2.6 5-2.2-.4 2-2 3.4-4 3.6zM19 9c-1.5-1.8-3.5-2.6-5-2.2.4 2 2 3.4 4 3.6z" fill="#8D6E63"/>'
    '<ellipse cx="12" cy="16" rx="4" ry="2.8" fill="#F8BBD0"/>'
    '<circle cx="9" cy="11.8" r="1.2" fill="#37474F"/><circle cx="15" cy="11.8" r="1.2" fill="#37474F"/>'
    '<circle cx="10.6" cy="16" r=".7" fill="#8D6E63"/><circle cx="13.4" cy="16" r=".7" fill="#8D6E63"/>')

# 🐹 仓鼠：圆润 + 大颊囊
_reg('🐹',
    '<circle cx="6.5" cy="6.5" r="2.4" fill="#E0A050"/><circle cx="17.5" cy="6.5" r="2.4" fill="#E0A050"/>'
    '<circle cx="12" cy="13" r="8" fill="#FFB74D"/>'
    '<circle cx="6.8" cy="14" r="2.6" fill="#FFCC80"/><circle cx="17.2" cy="14" r="2.6" fill="#FFCC80"/>'
    '<circle cx="9.4" cy="11.8" r="1.1" fill="#37474F"/><circle cx="14.6" cy="11.8" r="1.1" fill="#37474F"/>'
    '<ellipse cx="12" cy="15" rx="1.4" ry="1" fill="#5D4037"/>'
    '<path d="M10.5 17c.9.7 2.1.7 3 0" fill="none" stroke="#5D4037" stroke-width="1" stroke-linecap="round"/>')

# 🐰 兔：长竖耳 + 三瓣嘴感
_reg('🐰',
    '<ellipse cx="8.5" cy="5" rx="2.2" ry="4.5" fill="#F8BBD0"/><ellipse cx="15.5" cy="5" rx="2.2" ry="4.5" fill="#F8BBD0"/>'
    '<ellipse cx="8.5" cy="5.4" rx="1" ry="3.2" fill="#F48FB1"/><ellipse cx="15.5" cy="5.4" rx="1" ry="3.2" fill="#F48FB1"/>'
    '<circle cx="12" cy="14.5" r="7.5" fill="#FCE4EC"/>'
    '<circle cx="9.2" cy="13" r="1.2" fill="#37474F"/><circle cx="14.8" cy="13" r="1.2" fill="#37474F"/>'
    '<path d="M12 14.5v1.2M12 15.7a1.6 1.6 0 01-2.6.8M12 15.7a1.6 1.6 0 002.6.8" fill="none" stroke="#AD1457" stroke-width="1" stroke-linecap="round"/>'
    '<ellipse cx="12" cy="14" rx="1.2" ry=".9" fill="#F06292"/>')

# 🐻 熊：棕 + 圆耳大鼻
_reg('🐻',
    '<circle cx="5.8" cy="6.5" r="2.9" fill="#8D6E63"/><circle cx="18.2" cy="6.5" r="2.9" fill="#8D6E63"/>'
    '<circle cx="5.8" cy="6.5" r="1.3" fill="#A1887F"/><circle cx="18.2" cy="6.5" r="1.3" fill="#A1887F"/>'
    '<circle cx="12" cy="13" r="8" fill="#A1887F"/>'
    '<ellipse cx="12" cy="16" rx="4.6" ry="3.6" fill="#D7CCC8"/>'
    '<ellipse cx="12" cy="14.4" rx="1.8" ry="1.4" fill="#4E342E"/>'
    '<circle cx="9" cy="11" r="1.2" fill="#37474F"/><circle cx="15" cy="11" r="1.2" fill="#37474F"/>'
    '<path d="M10.6 17.5c.9.7 1.9.7 2.8 0" fill="none" stroke="#4E342E" stroke-width="1" stroke-linecap="round"/>')

# 🐨 考拉：银灰 + 大毛耳
_reg('🐨',
    '<circle cx="5.5" cy="7" r="3.4" fill="#90A4AE"/><circle cx="18.5" cy="7" r="3.4" fill="#90A4AE"/>'
    '<circle cx="5.5" cy="7" r="1.6" fill="#78909C"/><circle cx="18.5" cy="7" r="1.6" fill="#78909C"/>'
    '<circle cx="12" cy="13" r="7.8" fill="#B0BEC5"/>'
    '<ellipse cx="12" cy="15.5" rx="4.2" ry="3.4" fill="#CFD8DC"/>'
    '<circle cx="9.2" cy="11.5" r="1.2" fill="#37474F"/><circle cx="14.8" cy="11.5" r="1.2" fill="#37474F"/>'
    '<ellipse cx="12" cy="15" rx="1.6" ry="1.2" fill="#546E7A"/>')

# 🤖 机器人
_reg('🤖',
    '<rect x="5" y="7" width="14" height="11" rx="3" fill="#B0BEC5" stroke="#78909C" stroke-width="1"/>'
    '<path d="M12 4v3" stroke="#78909C" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="3.5" r="1.4" fill="#EF5350"/>'
    '<rect x="7.5" y="10" width="3.4" height="3" rx="1.2" fill="#4FC3F7"/>'
    '<rect x="13.1" y="10" width="3.4" height="3" rx="1.2" fill="#4FC3F7"/>'
    '<rect x="9" y="15" width="6" height="1.4" rx=".7" fill="#546E7A"/>')

# 👻 幽灵：波浪下摆
_reg('👻',
    '<path d="M12 3.5a7 7 0 017 7v9l-2.3-1.8-2.4 1.8-2.3-1.8-2.3 1.8-2.4-1.8L5 19.5v-9a7 7 0 017-7z" fill="#ECEFF1" stroke="#B0BEC5" stroke-width=".8"/>'
    '<ellipse cx="9.4" cy="11" rx="1.3" ry="1.6" fill="#37474F"/>'
    '<ellipse cx="14.6" cy="11" rx="1.3" ry="1.6" fill="#37474F"/>'
    '<ellipse cx="12" cy="14.6" rx="1.6" ry="1.1" fill="#546E7A"/>')

# 👽 外星人：大头 + 黑杏眼
_reg('👽',
    '<path d="M12 3.5c4.7 0 8 3.2 8 7.2 0 4.5-4 9.8-8 9.8s-8-5.3-8-9.8c0-4 3.3-7.2 8-7.2z" fill="#81C784"/>'
    '<ellipse cx="8.8" cy="11.5" rx="2" ry="2.8" fill="#1B5E20" transform="rotate(18 8.8 11.5)"/>'
    '<ellipse cx="15.2" cy="11.5" rx="2" ry="2.8" fill="#1B5E20" transform="rotate(-18 15.2 11.5)"/>'
    '<path d="M10.5 17h3" stroke="#2E7D32" stroke-width="1.2" stroke-linecap="round"/>')

def build_avatars():
    return AVATAR_SPEC
