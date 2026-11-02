import io
add = '''
# ==== 区域1卫生纪律(20261102): 调试/临时产物直接忽略, 不再入库 ====
tmp_*
debug_*.py
debug_pid.txt
succ_probe*
succ_scan*
*_diag*.py
*_diag*.txt
tmp3*/
%DST%
server/zf-trash/
server/data/stuck_stacks/
public/config/backups/models-auto-*.json
'''
with io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\.gitignore','a',encoding='utf-8') as f:
    f.write(add)
print('appended', len(add))
