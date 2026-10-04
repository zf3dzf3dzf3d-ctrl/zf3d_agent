# -*- coding: utf-8 -*-
"""server/cli.py - 智能体命令行独立入口（P2：多轮会话 + 批处理）

绕过 Web 前台，后台直接驱动智能体引擎跑完整 agent 循环。
用法（建议 chcp 65001 或用 -X utf8）：
    python\\python.exe -X utf8 server\\cli.py "帮我建一个test.txt内容为hello"
    python\\python.exe -X utf8 server\\cli.py --engine claude_code_style --cwd F:\\some\\dir "任务"
    python\\python.exe -X utf8 server\\cli.py --session demo           # 多轮 REPL（会话落库，前台可见可续聊）
    python\\python.exe -X utf8 server\\cli.py --task-file tasks.txt    # 批处理：每行一条任务
    python\\python.exe -X utf8 server\\cli.py --list-engines

退出码规范：0=全部成功；1=用法/配置错误；2=任务执行失败；130=用户中断。
"""
import os
import sys
import json
import time
import argparse

# ===== 路径设置：保证能 import server 根目录与 engines 包 =====
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)
# engines_loader 内部用 importlib.import_module(eid + '.engine')，
# 其 _ENGINES_DIR 已把 engines 目录插到 sys.path，这里保险再插一次
ENGINES_DIR = os.path.join(SERVER_DIR, 'engines')
if ENGINES_DIR not in sys.path:
    sys.path.insert(0, ENGINES_DIR)


def _build_model_ctx(model_name=''):
    """从服务端模型配置拿真实 endpoint/key，构造 agent_loop 所需 ctx。
    等价于前端 body 携带的 _target_url/headers/_project_path 等字段。"""
    import model_config
    cfg = model_config.load_models_config(include_key=True)
    models = cfg.get('list') or []
    m = None
    if model_name:
        for it in models:
            if it.get('name') == model_name:
                m = it
                break
        if m is None:
            raise SystemExit('[CLI] 找不到模型: %s（可用: %s）' % (
                model_name, ', '.join(x.get('name', '') for x in models)))
    else:
        m = model_config.get_default_model()
        if not m:
            # 退化：取第一个启用的语言模型
            for it in models:
                if it.get('enabled') and not it.get('imageGen'):
                    m = it
                    break
    if not m:
        raise SystemExit('[CLI] 没有可用模型配置，请先在前台配置模型')

    target_url = str(m.get('endpoint') or m.get('baseUrl') or '')
    key = str(m.get('key') or '')
    headers = {'Content-Type': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    headers['User-Agent'] = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                             'AppleWebKit/537.36 (KHTML, like Gecko) '
                             'Chrome/131.0.0.0 Safari/537.36')
    return m, target_url, headers


def _pick_engine(engines_loader, eid=''):
    """选引擎：优先 local_loop（带完整 agent 循环），否则退默认引擎。"""
    if not eid:
        for _id, m in engines_loader.load_engines().items():
            if m.get('enabled', True) and engines_loader.engine_owns_tools(_id):
                eid = _id
                break
        eid = eid or engines_loader.DEFAULT_ENGINE
    if engines_loader.get_manifest(eid) is None:
        raise SystemExit('[CLI] 引擎不可用: %s（--list-engines 查看）' % eid)
    return eid


def _persist_turn(session_id, turn_no, role, content):
    """CLI 会话落库（与 Web 同库同格式，前台可见）。失败仅提示不中断。"""
    try:
        import db
        db.write_agent_turn(session_id, turn_no, role, content)
    except Exception as e:
        print('[CLI] 会话落库失败(忽略): %s' % e)


def run_once(args, prompt, eid, turn_no=0):
    """跑一轮任务，返回 (最终回复文本, 原始 final dict)。异常向上抛。"""
    import engines_loader

    model, target_url, headers = _build_model_ctx(args.model)

    payload = {
        'model': model.get('modelId') or model.get('name'),
        'messages': [{'role': 'user', 'content': prompt}],
        'temperature': model.get('temperature', 0.7),
        'max_tokens': model.get('maxTokens', 8192),
        'stream': False,
    }

    loop_ctx = {
        'payload': payload,
        'headers': headers,
        'target_url': target_url,
        'project_path': os.path.abspath(args.cwd),
        'turbo': False,
        '_session_id': args.session or 'cli-%s' % os.getpid(),
        '_box_id': '',
    }

    os.chdir(loop_ctx['project_path'])

    # ===== 先走引擎预处理（与 Web 路径一致），再跑完整 agent 循环 =====
    eng_mod = engines_loader.get_module(eid)
    try:
        eng_ret = engines_loader.run_engine(eid, payload['messages'], {
            'payload': payload, 'headers': headers,
            'target_url': target_url, 'project_path': loop_ctx['project_path'],
            '_box_id': '', '_session_id': loop_ctx['_session_id']})
        if isinstance(eng_ret, dict):
            if isinstance(eng_ret.get('payload'), dict):
                payload = loop_ctx['payload'] = eng_ret['payload']
            if eng_ret.get('target_url'):
                target_url = loop_ctx['target_url'] = eng_ret['target_url']
    except Exception as e:
        print('[CLI] 引擎预处理失败（继续直连）: %s' % e)

    if args.raw:
        # ===== 纯对话直连：用预处理后的 payload/headers/target_url 发 OpenAI 兼容请求 =====
        import urllib.request
        req = urllib.request.Request(
            target_url, data=json.dumps(payload).encode('utf-8'),
            headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=600) as resp:
            final = json.loads(resp.read().decode('utf-8'))
    else:
        try:
            from engines.common import agent_loop
        except ImportError:
            import agent_loop
        final = agent_loop.run_agent_loop(eid, eng_mod, payload.get('messages'), loop_ctx)

    text = ''
    if isinstance(final, dict):
        choices = final.get('choices') or []
        if choices and isinstance(choices[0], dict):
            msg = choices[0].get('message') or {}
            text = msg.get('content') or ''
    return text, final


def main():
    ap = argparse.ArgumentParser(description='朱峰智能体 CLI 后台直驱入口')
    ap.add_argument('prompt', nargs='?', help='要发给智能体的任务/问题')
    ap.add_argument('--engine', default='', help='引擎 id（默认用 local_loop 类引擎里第一个启用的）')
    ap.add_argument('--model', default='', help='模型配置名（默认取默认模型）')
    ap.add_argument('--cwd', default=os.getcwd(), help='智能体工作目录')
    ap.add_argument('--session', default='', help='会话 id（指定后落库 agent_turns，与前台互通；REPL 多轮共用）')
    ap.add_argument('--json', action='store_true', help='输出原始 JSON（批处理时为 NDJSON）')
    ap.add_argument('--raw', action='store_true', help='纯对话直连（不发工具、不跑 agent 循环）')
    ap.add_argument('--task-file', default='', help='批处理：文件每行一条任务，顺序执行')
    ap.add_argument('--stop-on-error', action='store_true', help='批处理遇错即停（默认失败继续）')
    ap.add_argument('--pipeline', default='', help='蜂群流水线：JSON 配置文件（goal/planners/builders/reviewers）')
    ap.add_argument('--list-engines', action='store_true', help='列出可用引擎')
    ap.add_argument('--key-check', action='store_true', help='只跑 API Key 启动体检并退出（不调模型）')
    args = ap.parse_args()

    # D2: API Key 启动体检（任何异常都不影响主流程）
    try:
        import key_audit as _ka
        _r = _ka.audit_keys()
        if not _r['ok']:
            print('[Key体检] %d 条警告:' % len(_r['warnings']))
            for _w in _r['warnings']:
                print('  [!] %s' % _w)
        else:
            print('[Key体检] 通过（%d 项）' % len(_r['items']))
    except Exception:
        pass

    import engines_loader

    if args.key_check:
        try:
            import key_audit as _ka
            _ka.print_report()
        except Exception as _e:
            print('[Key体检] 失败: %r' % _e)
        return 0

    if args.list_engines:
        for eid, m in engines_loader.load_engines().items():
            print('%-24s %-10s %s' % (eid, m.get('engine_mode', '-'),
                                      str(m.get('name') or m.get('description') or '')[:40]))
        return 0

    # ===== 模式0：蜂群流水线 --pipeline（策划→收口→施工→审核→总结） =====
    if args.pipeline:
        if not os.path.isfile(args.pipeline):
            print('[CLI] 流水线配置不存在: %s' % args.pipeline)
            return 1
        try:
            with open(args.pipeline, 'r', encoding='utf-8') as f:
                pcfg = json.load(f)
        except Exception as e:
            print('[CLI] 流水线配置解析失败: %s' % e)
            return 1
        import swarm_pipeline
        code, rep = swarm_pipeline.run_pipeline(
            pcfg, cwd=args.cwd if os.path.isabs(args.cwd) else None)
        if args.json:
            print(json.dumps({'exit': code, 'report': {k: rep.get(k) for k in
                                                       ('id', 'goal', 'elapsed', 'report_path', 'stages', 'error')}},
                             ensure_ascii=False))
        return code

    eid = _pick_engine(engines_loader, args.engine)
    session_id = args.session or 'cli-%s' % os.getpid()

    # ===== 模式1：批处理 --task-file =====
    if args.task_file:
        tf = args.task_file
        if not os.path.isfile(tf):
            print('[CLI] 任务文件不存在: %s' % tf)
            return 1
        try:
            with open(tf, 'r', encoding='utf-8') as f:
                tasks = [ln.strip() for ln in f if ln.strip() and not ln.strip().startswith('#')]
        except UnicodeDecodeError:
            # Windows 记事本/echo 生成的文件可能是 GBK/ANSI 编码，回退读取
            with open(tf, 'r', encoding='gbk', errors='replace') as f:
                tasks = [ln.strip() for ln in f if ln.strip() and not ln.strip().startswith('#')]
        if not tasks:
            print('[CLI] 任务文件为空: %s' % tf)
            return 1
        turn_no = int(time.time())
        ok_cnt, fail_cnt = 0, 0
        for i, task in enumerate(tasks, 1):
            head = '[%d/%d]' % (i, len(tasks))
            print('%s %s' % (head, task[:60]))
            try:
                text, final = run_once(args, task, eid, turn_no=turn_no + i)
                if args.json:
                    print(json.dumps({'index': i, 'ok': True, 'final': final},
                                     ensure_ascii=False))
                else:
                    print(text or '(空回复)')
                _persist_turn(session_id, turn_no + i, 'user', task)
                _persist_turn(session_id, turn_no + i, 'assistant', text)
                ok_cnt += 1
            except KeyboardInterrupt:
                print('%s 用户中断' % head)
                return 130
            except Exception as e:
                print('%s 失败: %s' % (head, e))
                fail_cnt += 1
                if args.stop_on_error:
                    return 2
        print('===== 批处理汇总: 成功 %d / 失败 %d / 共 %d =====' % (ok_cnt, fail_cnt, len(tasks)))
        return 2 if fail_cnt else 0

    # ===== 模式2：多轮 REPL --session（无 prompt 时进入交互） =====
    if not args.prompt and sys.stdin is not None and sys.stdin.isatty():
        print('[CLI] 进入多轮 REPL（会话: %s），输入 exit/quit 或 Ctrl+C 两次退出。' % session_id)
        turn_no = int(time.time())
        n = 0
        while True:
            try:
                line = input('zf> ').strip()
            except EOFError:
                break
            except KeyboardInterrupt:
                print('\n(再按一次 Ctrl+C 退出)')
                try:
                    input()
                    continue
                except (KeyboardInterrupt, EOFError):
                    break
            if not line:
                continue
            if line.lower() in ('exit', 'quit'):
                break
            n += 1
            try:
                text, final = run_once(args, line, eid, turn_no=turn_no + n)
                print(text or '(空回复)')
                _persist_turn(session_id, turn_no + n, 'user', line)
                _persist_turn(session_id, turn_no + n, 'assistant', text)
            except KeyboardInterrupt:
                print('\n(本轮中断)')
            except Exception as e:
                print('[CLI] 本轮失败: %s' % e)
        return 0

    # ===== 模式3：单条任务 =====
    if not args.prompt:
        if sys.stdin is not None and not sys.stdin.isatty():
            # D5: 管道/脚本调用且忘带 --prompt 时给出明确指引，而不是默默打印帮助
            print('[CLI] 检测到非交互管道输入(stdin 非 tty)：单条任务请用 --prompt 传入，'
                  '多行任务请用 --task-file。')
        ap.print_help()
        return 1

    # D5: turn_no 用毫秒时间戳，避免同秒内多个 CLI 实例轮次号撞车
    turn_no = int(time.time() * 1000)
    try:
        text, final = run_once(args, args.prompt, eid, turn_no=turn_no + 1)
    except KeyboardInterrupt:
        return 130
    except SystemExit:
        raise
    except Exception as e:
        print('[CLI] 任务失败: %s' % e)
        return 2

    _persist_turn(session_id, turn_no + 1, 'user', args.prompt)
    _persist_turn(session_id, turn_no + 1, 'assistant', text)

    if args.json:
        print(json.dumps(final, ensure_ascii=False, indent=2))
    else:
        print(text or '(空回复)')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
