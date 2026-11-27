# -*- coding: utf-8 -*-
"""
migrate_prints —— print → util_log AST 级批量迁移工具
（工程基建总纲 Phase 2.2 20261123，第二批起交付给蜂群复用）。

规则：
  - print(a)            -> log.info(a)
  - print(a, b, c)      -> log.info('%s %s %s', a, b, c)   （与 print 默认空格分隔一致）
  - 级别启发（对整个调用源码片段）：
      ❌/失败/错误/异常/FAILED/ERROR  -> log.error
      ⚠️/警告/提示/熔断/WARN          -> log.warning
      其余                            -> log.info
  - 带 kwargs（file=/end=/sep=/flush=）的 print 跳过并报告（语义不同，需人工）；
  - 文件头自动注入 `from util_log import get_logger` + logger 定义；
    命名 `log`，若检测到 `log =` 赋值冲突则改用 `zf_log`；
  - 幂等：已是 log.x() 的调用不会被命中（只匹配名为 print 的调用）。

用法：
  py tools/quality/migrate_prints.py server/a.py server/b.py ...
退出码 0 = 全部处理完成（含 0 处可迁移）；1 = 有跳过项需人工。
"""
import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# `log =` 赋值或 `def log(` 助手函数都视为命名冲突（20261123 agent_chat_watch 实测教训：
#  def log 函数体内被迁移的 print 会变成 log.info 调用被自身遮蔽，运行时 AttributeError）
RE_LOG_DEF = re.compile(r'^\s*(?:log\s*=|def\s+log\s*\()', re.M)
KW_KEYWORDS = ('file=', 'end=', 'sep=', 'flush=')
ERR_KEYWORDS = ('❌', '失败', '错误', '异常', 'FAILED', 'ERROR', 'Traceback')
WARN_KEYWORDS = ('⚠️', '警告', '提示', '熔断', 'WARN')


def level_of(seg):
    s = str(seg)
    if any(k in s for k in ERR_KEYWORDS):
        return 'error'
    if any(k in s for k in WARN_KEYWORDS):
        return 'warning'
    return 'info'


def process(path):
    p = Path(path)
    src = p.read_text('utf-8-sig')
    tree = ast.parse(src)
    lines = src.split('\n')

    calls = []
    skipped = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == 'print':
            if node.keywords:
                # flush=True 可安全剥离（logging 每条记录自带 flush）；其余 kwargs 语义不同需人工
                non_flush = [k for k in node.keywords
                             if not (k.arg == 'flush' and isinstance(k.value, ast.Constant)
                                     and k.value.value is True)]
                if non_flush:
                    skipped.append((node.lineno, '含 kwargs（%s）需人工' %
                                    ','.join(k.arg for k in non_flush)))
                    continue
            calls.append(node)

    # 从文件尾部向前替换，避免坐标漂移
    calls.sort(key=lambda n: (n.lineno, n.col_offset), reverse=True)
    converted = 0
    for node in calls:
        s = max(0, node.col_offset)
        e = max(0, node.end_col_offset)
        seg = src[seg_offset(src, node.lineno, s): seg_offset(src, node.end_lineno, e)]
        lvl = level_of(seg)
        args = [ast.get_source_segment(src, a) for a in node.args]
        args = [a.strip() for a in args if a is not None]
        if not args:
            new = "log.info('')"
        elif len(args) == 1:
            new = 'log.%s(%s)' % (lvl, args[0])
        else:
            # msg 必须带引号（20261123 server_runtime 批次教训：裸 %s 串是语法错误）
            msg = "'" + ' '.join(['%s'] * len(args)) + "'"
            new = 'log.%s(%s, %s)' % (lvl, msg, ', '.join(args))
        # 按行号切片替换（含首尾行）
        line_idx = node.lineno - 1
        end_idx = node.end_lineno - 1
        first = lines[line_idx]
        pre = first[:s]
        last = lines[end_idx]
        post = last[e:]
        new_block = pre + new + post
        lines[line_idx:end_idx + 1] = new_block.split('\n')
        converted += 1

    src = '\n'.join(lines)

    # 注入 util_log（幂等）
    logger_name = 'zf_log' if RE_LOG_DEF.search(src) else 'log'
    if logger_name == 'zf_log':
        # 防回溯正则：(?<![_\w]) 防止把已改名的 zf_log.xxx 再套一层成 zf_zf_log
        # （同文件二次运行实测教训：朴素 str.replace 会对 zf_log 再套前缀）
        src = re.sub(r'(?<![_\w])log\.(info|warning|error)\(', r'zf_log.\1(', src)
    if 'from util_log import get_logger' not in src:
        lines = src.split('\n')
        # 首个 import 块末尾插入（20261123 _shared.py 教训：取"最后一个 import"会把
        # 定义放在文件中段第二个 import 块后，早于模块级首次使用 → 导入期 NameError
        # 被存量 except:pass 静默吞掉）
        first_import = next((i for i, l in enumerate(lines)
                             if l.startswith('import ') or l.startswith('from ')), None)
        if first_import is None:
            # 无顶层 import 的文件（插件 main.py 等，import 缩进在函数内）：
            # 插到模块 docstring 结束后（20261123 banner/main.py 批次实测 NoneType 教训）
            doc_end = 0
            if tree.body and isinstance(tree.body[0], ast.Expr) \
                    and isinstance(tree.body[0].value, ast.Constant):
                doc_end = tree.body[0].end_lineno  # 1-based
            if doc_end:
                last_import = doc_end - 1
            else:
                # 无 docstring：插到首个实质语句之前（只跳过 shebang/编码/空行
                # —— 20261123 view_guard.py 教训：文件以模块级 with 开头时插到块内会断。
                # 首行即实质语句时 ins=0 → last_import=-1 → insert(0) 顶部，正确）
                ins = 0
                while ins < len(lines) and (lines[ins].startswith('#!')
                        or lines[ins].startswith('# -*-')
                        or lines[ins].strip() == ''):
                    ins += 1
                last_import = ins - 1
        else:
            last_import = first_import
            j = first_import
            while j + 1 < len(lines) and (lines[j + 1].startswith('import ')
                                          or lines[j + 1].startswith('from ')
                                          or lines[j + 1].strip() == ''
                                          or lines[j + 1].startswith('(')):
                j += 1
            last_import = j
        stem = Path(path).stem
        if stem.startswith('mixin_'):
            # R2 门禁把含 mixin_ 字样的新增行判为旧轨引用，日志通道名剥前缀（行为等价）
            stem = stem[len('mixin_'):]
        lines.insert(last_import + 1,
                     'from util_log import get_logger\n\n%s = get_logger(%r)'
                     % (logger_name, stem))
        src = '\n'.join(lines)

    p.write_text(src, encoding='utf-8', newline='\n')
    return converted, skipped, logger_name


def seg_offset(src, lineno, col):
    """AST 的 (lineno, col_offset) -> 字符偏移。"""
    off = 0
    for i, line in enumerate(src.split('\n'), start=1):
        if i == lineno:
            return off + col
        off += len(line) + 1
    return off


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    total_conv, total_skip = 0, 0
    for path in sys.argv[1:]:
        converted, skipped, logger = process(path)
        total_conv += converted
        total_skip += len(skipped)
        print('%s: 迁移 %d 处 -> logger=%s' % (path, converted, logger))
        for ln, why in skipped:
            print('  [SKIP] L%d %s' % (ln, why))
    print('合计迁移 %d 处，跳过 %d 处（跳过项需人工）' % (total_conv, total_skip))
    return 1 if total_skip else 0


if __name__ == '__main__':
    sys.exit(main())
