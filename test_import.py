import sys
sys.path.insert(0, '公共区/内核')
from 操作基类 import *
classes = ['操作结果', '操作基类', '创建文件', '读取文件', '写入文件', '追加文件', '删除文件',
           '替换文本', '批量编辑', '列出目录', '搜索代码', 'Glob搜索', '符号搜索', '验证代码',
           'Git状态', 'Git提交', 'Git回滚', 'Git差异', 'Git日志', 'Git分支',
           '打开程序', '运行命令', '截图', '获取时间', '系统信息', '等待', '数学计算', 'JSON操作',
           '网页抓取', '网络搜索', '网页分析', '图片分析',
           '子代理', '并行执行', 'Pipeline', 'Barrier', 'LoopUntilDry', '后台执行', '获取后台结果',
           'Job创建', 'Job更新', 'Job列表', 'Job详情']
for c in classes:
    assert c in dir(), f'{c} not found!'
print(f'全部 {len(classes)} 个操作类导入成功')
