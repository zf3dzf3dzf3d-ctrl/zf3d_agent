# -*- coding: utf-8 -*-
"""
路由清单精确解析器（P0 表驱动重构前置产出物）
用 Python AST 解析 api_dispatch_get.py / api_dispatch_post.py 中
  if path == '...' / if path.startswith('...') / elif ... / s == '...' 等路由分支,
产出带行号+方法(GET/POST)+路径字面量的路由清单（唯一权威，动工当日重跑）。

口径（2026-11-11 第11轮裁决钉死）：
- 只认「比较对象是 path / p / pth / url 等路径变量」的 == 与 .startswith() 判断
- elif 链归并到其 if 的同一分支记录（含行号）
- 输出汇总行 ROUTES_GET=<n> ROUTES_POST=<n> 供巡检/回归清单使用

用法: python 路由清单.py [--csv out.csv]
"""
import ast, io, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FILES = {
    'GET': os.path.join(ROOT, 'server', 'routes', 'api_dispatch_get.py'),
    'POST': os.path.join(ROOT, 'server', 'routes', 'api_dispatch_post.py'),
}
PATH_VARS = {'path', 'p', 'pth', 'url', 'route', 'key', 'k'}

def _is_path_cmp(test):
    """判断一个 test 节点是否是「路径变量 == 字面量」或「路径变量.startswith(字面量)」"""
    # path == 'x' / 'x' == path
    if isinstance(test, ast.Compare) and len(test.ops) == 1 and isinstance(test.ops[0], (ast.Eq,)):
        left, right = test.left, test.comparators[0]
        name = None
        if isinstance(left, ast.Name) and left.id in PATH_VARS and isinstance(right, ast.Constant):
            name = right.value
        elif isinstance(right, ast.Name) and right.id in PATH_VARS and isinstance(left, ast.Constant):
            name = left.value
        if isinstance(name, str):
            return ('==', name)
    # path.startswith('x')
    if isinstance(test, ast.Call) and isinstance(test.func, ast.Attribute) \
            and test.func.attr == 'startswith' and isinstance(test.func.value, ast.Name) \
            and test.func.value.id in PATH_VARS and test.args \
            and isinstance(test.args[0], ast.Constant) and isinstance(test.args[0].value, str):
        return ('startswith', test.args[0].value)
    return None

def parse_file(fp):
    rows = []
    src = io.open(fp, 'r', encoding='utf-8').read()
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if not isinstance(node, ast.If):
            continue
        hit = _is_path_cmp(node.test)
        if hit:
            rows.append({'line': node.lineno, 'kind': hit[0], 'route': hit[1]})
        # elif 链: ast 的 elif 是 orelse 里的 If，ast.walk 也能遍历到，无需特殊处理
    # 去重（同一行只会出现一次）
    seen, uniq = set(), []
    for r in rows:
        key = (r['line'], r['kind'], r['route'])
        if key not in seen:
            seen.add(key)
            uniq.append(r)
    uniq.sort(key=lambda r: r['line'])
    return uniq

def main():
    csv_out = None
    if '--csv' in sys.argv:
        csv_out = sys.argv[sys.argv.index('--csv') + 1]
    all_rows = {}
    for method, fp in FILES.items():
        rows = parse_file(fp)
        all_rows[method] = rows
        eq = sum(1 for r in rows if r['kind'] == '==')
        sw = sum(1 for r in rows if r['kind'] == 'startswith')
        print(f'[{method}] {os.path.basename(fp)}: total={len(rows)} (== {eq} / startswith {sw})')
        for r in rows:
            print(f"  L{r['line']:>5} {r['kind']:<10} {r['route']}")
    print(f"ROUTES_GET={len(all_rows['GET'])} ROUTES_POST={len(all_rows['POST'])}")
    if csv_out:
        with io.open(csv_out, 'w', encoding='utf-8') as f:
            f.write('method,line,kind,route\n')
            for m, rows in all_rows.items():
                for r in rows:
                    f.write(f"{m},{r['line']},{r['kind']},{r['route']}\n")
        print(f'CSV_WRITTEN={csv_out}')

if __name__ == '__main__':
    main()
