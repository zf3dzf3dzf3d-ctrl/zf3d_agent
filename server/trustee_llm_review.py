# -*- coding: utf-8 -*-
"""
i托管 P1.5 — LLM 审批通道（few-shot 注入案例库 + 结构化裁决）
==============================================================
策划案 v1.7 P1.5 期：对「任务收口报告」做 LLM 审批 dry-run。
- 通道：复用 supervisor._llm_judge 同款链路（model_config 默认模型；
  zf_models_relay 线路走本地 /api/zf3d/relay-proxy 中转补鉴权）。
- few-shot：从 private/trustee_cases/ 读案例（A 正例/R 反例/G 金丝雀）注入 system prompt。
- 输出结构化：{"verdict":"approve|reject|abstain","reason":"..."}；解析失败按 abstain（转人工）。
- 熔断由 mixin_trustee 条款#7 外层管理，本模块自身不熔断。
dry-run 入口：python trustee_llm_review.py  → 对案例库自测跑一轮。
"""
import os
import re
import json
import sys

from util_log import get_logger

log = get_logger('trustee_llm_review')
_DIR = os.path.dirname(os.path.abspath(__file__))
# __main__ 直跑自举：server 目录进 sys.path，保证 import supervisor 可用（服务器内由 mixin 已注入，重复添加无害）
if _DIR not in sys.path:
    sys.path.insert(0, _DIR)
CASES_DIR = os.path.normpath(os.path.join(_DIR, '..', 'private', 'trustee_cases'))

JUDGE_SYS_PROMPT = (
    '你是「i托管」收口审批员，只读不改，没有工具。你会收到一份任务收口报告（AI 声称完成情况+证据摘要）。'
    '你按下面示范案例的判据裁决，并给两个分数：\n'
    ' progress = 工程完成度（0-100 整数）：按证据评估任务实际完成比例，不接受自报值。\n'
    ' review = 审核质量分（0-100 整数）：评估证据的真实性/可复核性/与声称的一致性。\n'
    ' verdict：approve = 有命令级实测证据且与声称一致；主体完成+遗留如实披露且遗留属用户动作类（重启/目视）也可 approve 并注明条件。\n'
    ' verdict：reject = 声称与实测不符、证据缺失、命令空转假成功、修复被回退或只进不被伺服副本、归因错误、虚报评分、硬凑成功理由。\n'
    ' verdict：abstain = 证据不足以裁决（宁缺勿滥，此时 progress/review 给 null）。\n'
    ' decision（按分数带给出处置建议）：adopt=收口（进度≥95 且 审核>90）；dispatch_verify=需独立复核；'
    'dispatch_optimize=需优化返工；redo=需换队重做（任一分数<60）；escalate_human=转人工。\n'
    '只输出一行 JSON：{"verdict":"approve|reject|abstain","progress":0-100或null,"review":0-100或null,'
    '"decision":"adopt|dispatch_verify|dispatch_optimize|redo|escalate_human","reason":"一句话中文说明"}，不要输出其他内容。\n'
    '——示范案例——\n{fewshot}\n——案例结束——'
)


def load_fewshot(max_cases=10, max_len=400):
    """从案例库目录组装 few-shot 文本块。"""
    shots = []
    try:
        if os.path.isdir(CASES_DIR):
            for name in sorted(os.listdir(CASES_DIR)):
                if not name.endswith('.md') or name == 'README.md':
                    continue
                try:
                    with open(os.path.join(CASES_DIR, name), 'r', encoding='utf-8') as f:
                        txt = f.read()
                    shots.append('[%s] %s' % (os.path.splitext(name)[0], txt.strip()[:max_len]))
                except Exception:
                    continue
                if len(shots) >= max_cases:
                    break
    except Exception:
        pass
    return '\n'.join(shots) or '(案例库为空)'


def build_report(case_text):
    """审批包组装：对单份收口报告文本生成 user 消息。"""
    return '【收口报告】\n%s' % str(case_text or '').strip()


def _clamp_score(v):
    """分数钳制：None/非法 → None；其余钳到 0-100 整数。"""
    try:
        if v is None or v == '':
            return None
        f = float(v)
        if f != f:  # NaN
            return None
        return int(max(0, min(100, round(f))))
    except Exception:
        return None


_VALID_DECISIONS = ('adopt', 'dispatch_verify', 'dispatch_optimize', 'redo', 'escalate_human')


def parse_full(txt):
    """P2 结构化解析：verdict + 双分数(progress/review) + decision。
    【P1 fail-closed 收紧】approve/reject 只认 JSON 结构化解析的结果；
    无分数不再自动补满分（保持 None，由下游 _score_band 无分→escalate_human 门槛自然拦截），
    防"关键词误判 approve → 白送 100/100 分 → 自动收口"的 fail-open 通路。"""
    txt = str(txt or '')
    obj = None
    try:
        s = txt.find('{')
        e = txt.rfind('}')
        if s >= 0 and e > s:
            obj = json.loads(txt[s:e + 1])
    except Exception:
        obj = None
    if obj is None:
        for line in txt.splitlines():
            if '{' not in line:
                continue
            try:
                ls, le = line.find('{'), line.rfind('}')
                if le <= ls:
                    continue
                obj = json.loads(line[ls:le + 1])
                break
            except Exception:
                continue
    if isinstance(obj, dict):
        v = _normalize_verdict(str(obj.get('verdict') or ''))
        if v:
            progress = _clamp_score(obj.get('progress'))
            review = _clamp_score(obj.get('review'))
            dec = str(obj.get('decision') or '').strip()
            if dec not in _VALID_DECISIONS:
                dec = ''
            # 【P1 fail-closed】不再给 approve 自动补 100/100：无分数保持 None，
            # 由下游 _score_band（无分→escalate_human）自然拦截为转人工
            return {'verdict': v, 'reason': str(obj.get('reason') or '')[:200],
                    'progress': progress, 'review': review, 'decision': dec}
    # 非 JSON 兜底（fail-closed）：关键词路径只接受 reject 降级（parse_verdict 兜底
    # 已不再升格 approve）；其余一律 abstain + 转人工，不给任何分数
    v, r = parse_verdict(txt)
    if v == 'reject':
        return {'verdict': 'reject', 'reason': r, 'progress': None, 'review': None, 'decision': ''}
    return {'verdict': 'abstain', 'reason': r, 'progress': None, 'review': None, 'decision': 'escalate_human'}


def parse_verdict(txt):
    """从 LLM 回复提取裁决：先 JSON（容忍 markdown 包裹/多行拆裂），失败走关键词正则兜底。
    v2 放宽：①逐行尝试拆出被换行拆裂的 JSON；②正则直接抓 verdict 字段值；
    ③逐行扫描裁决关键词（按行优先于全文，避免正文词污染）。
    【P1 fail-closed】approve/reject 只认 JSON 结构化解析（①②的 json.loads 主路径）；
    关键词兜底路径仅当命中 reject 类关键词才降级为 reject，命中 approve 类不再升格为
    approve（返回 abstain 转人工），防报告正文出现"通过/同意"字样即误判收口。"""
    txt = str(txt or '')
    try:
        s = txt.find('{')
        e = txt.rfind('}')
        if s >= 0 and e > s:
            obj = json.loads(txt[s:e + 1])
            v = _normalize_verdict(str(obj.get('verdict') or ''))
            if v:
                return v, str(obj.get('reason') or '')[:200]
    except Exception:
        pass
    # 放宽①：逐行拆 JSON（LLM 输出被换行/前缀拆裂时）——仍属结构化解析，approve 可信
    for line in txt.splitlines():
        if '{' not in line:
            continue
        try:
            ls, le = line.find('{'), line.rfind('}')
            if le <= ls:
                continue
            obj = json.loads(line[ls:le + 1])
            v = _normalize_verdict(str(obj.get('verdict') or ''))
            if v:
                return v, str(obj.get('reason') or '')[:200]
        except Exception:
            continue
    # 以下均为非结构化兜底：fail-closed，仅 reject/abstain 可判，approve 一律不升格
    # 放宽②：正则直接抓 verdict 字段（含中文裁决词）
    m = re.search(r'verdict["\']?\s*[:：=]\s*["\']?(approve|reject|abstain|通过|驳回|打回|弃权|转人工|同意)', txt, re.I)
    if m:
        v = _normalize_verdict(m.group(1), allow_approve=False)
        if v:
            return v, '字段抓取: %s' % txt.strip()[:120]
    # 放宽③：逐行扫描裁决关键词（首条命中即用，防正文提及污染——优先短行/裁决行）
    for line in txt.splitlines():
        v = _normalize_verdict(line, allow_approve=False)
        if v:
            return v, '逐行兜底解析: %s' % line.strip()[:120]
    v = _normalize_verdict(txt, allow_approve=False)
    if v:
        return v, '关键词兜底解析: %s' % txt.strip()[:120]
    return 'abstain', '解析失败转人工'


def _normalize_verdict(s, allow_approve=True):
    """裁决词归一化；识别不出返回 None。

    allow_approve=False（非 JSON 关键词兜底路径专用，fail-closed）：
    命中 approve 类关键词不再升格为 approve（返回 None → 上层按 abstain+转人工），
    仅 reject 类关键词可降级为 reject。
    """
    s = str(s or '').lower()
    if not s:
        return None
    if allow_approve and re.search(r'approve|approved|通过|同意', s):
        return 'approve'
    if re.search(r'reject|驳回|打回|不符|假成功|虚报', s):
        return 'reject'
    if re.search(r'abstain|弃权|转人工|无法裁决|证据不足|absten', s):
        return 'abstain'
    return None


def _http_with_retry(req, timeout, retries=2, backoff=2.0):
    """带重试+指数退避的 urlopen（治 502/连接重置/超时类上游抖动）。"""
    import urllib.request as _u
    import time as _t
    opener = _u.build_opener(_u.ProxyHandler({}))
    last_err = None
    for i in range(retries + 1):
        try:
            return opener.open(req, timeout=timeout)
        except Exception as e:
            last_err = e
            if i < retries:
                _t.sleep(backoff * (i + 1))
    raise last_err


def review_report(case_text, timeout=90):
    """对一份收口报告做 LLM 审批。返回 dict：{verdict, reason, progress, review, decision}。
    任何异常按 abstain+转人工（P2 分数/裁决字段见 parse_full）。"""
    try:
        import supervisor
        if not getattr(supervisor, '_TRUSTEE_LLM_VIA_SUPERVISOR', False):
            raise AttributeError('supervisor 通道默认停用（防无超时挂起），走内置实现')
        fewshot = load_fewshot()
        sys_prompt = JUDGE_SYS_PROMPT.replace('{fewshot}', fewshot)
        verdict, reason = supervisor._llm_chat_raw(
            sys_prompt, build_report(case_text), timeout=timeout)
        return parse_full(verdict)
    except AttributeError:
        pass  # supervisor 无 _llm_chat_raw 或开关关闭时走内置实现
    except Exception as e:
        return {'verdict': 'abstain', 'reason': '通道异常: %s' % str(e)[:120],
                'progress': None, 'review': None, 'decision': 'escalate_human'}
    return _review_via_supervisor_chain(case_text)


def _review_via_supervisor_chain(case_text):
    """复用 supervisor._llm_judge 的 HTTP 链路（临时适配层：拼 prompt 直接调）。"""
    try:
        import urllib.request as _u
        import json as _j
        try:
            import model_config as _mc
            m = _mc.get_default_model() or {}
        except Exception:
            return {'verdict': 'abstain', 'reason': '无模型配置',
                    'progress': None, 'review': None, 'decision': 'escalate_human'}
        url = str(m.get('endpoint') or m.get('baseUrl') or '').strip()
        key = str(m.get('key') or '')
        model = str(m.get('modelId') or m.get('id') or m.get('model') or m.get('name') or '')
        if not url:
            return {'verdict': 'abstain', 'reason': '无模型配置',
                    'progress': None, 'review': None, 'decision': 'escalate_human'}
        fewshot = load_fewshot()
        payload = {
            'model': model, 'stream': False,
            'messages': [
                {'role': 'system', 'content': JUDGE_SYS_PROMPT.replace('{fewshot}', fewshot)},
                {'role': 'user', 'content': build_report(case_text)},
            ],
        }
        # 【P0-2 收编 20261123】relay 识别统一走 security.is_zf_relay_url（域名精确匹配）
        import security as _sec
        if _sec.is_zf_relay_url(url):
            try:
                with open(os.path.join(_DIR, '..', 'private', 'port.json'), 'r', encoding='utf-8-sig') as _pf:
                    api_port = _j.load(_pf).get('api_port') or 8620
            except Exception:
                api_port = 8620
            req = _u.Request('http://127.0.0.1:%d/api/zf3d/relay-proxy' % api_port,
                             data=_j.dumps({'model': model, 'payload': payload}, ensure_ascii=True).encode('utf-8'),
                             method='POST')
            req.add_header('Content-Type', 'application/json')
            timeout = 90
        else:
            headers = {'Content-Type': 'application/json'}
            if key:
                headers['Authorization'] = 'Bearer ' + key
            req = _u.Request(url, data=_j.dumps(payload, ensure_ascii=True).encode('utf-8'), method='POST')
            for hk, hv in headers.items():
                req.add_header(hk, str(hv))
            timeout = 60
        with _http_with_retry(req, timeout=timeout) as resp:
            body = _j.loads(resp.read().decode('utf-8', errors='replace'))
        txt = str(((body.get('choices') or [{}])[0].get('message') or {}).get('content') or '')
        return parse_full(txt)
    except Exception as e:
        return {'verdict': 'abstain', 'reason': '通道异常: %s' % str(e)[:120],
                'progress': None, 'review': None, 'decision': 'escalate_human'}


# ---------------- dry-run 自测 ----------------

# 金丝雀样例（不依赖外部 LLM 也能验证组装/解析链路的单元部分）
_SELFTEST_CASES = [
    ('G1_金丝雀_披露即免打回',
     '任务：修复四球系统。主体代码已入库（commit 在链，双副本一致，语法校验通过），'
     '但运行时验证依赖用户重启浏览器刷新未做，报告如实声明「待用户刷新目视确认」。'),
    ('R1_空转假成功',
     '任务：诊断死锁。执行 89 次 run_code 全部退化为空 codes 空转，无一条命令有真实输出，'
     '最终报告声称「任务成功完成」。'),
]


def dry_run(live=False):
    """dry-run：live=False 只跑组装/解析单元自测；live=True 真调 LLM。"""
    results = []
    fewshot = load_fewshot()
    results.append(('fewshot_assemble', 'PASS' if 'A1' in fewshot and 'R1' in fewshot else 'FAIL',
                    '案例注入 %d 条' % (fewshot.count('[A') + fewshot.count('[R') + fewshot.count('[G'))))
    for name, report in _SELFTEST_CASES:
        if live:
            j = review_report(report)
            v, r = j.get('verdict'), j.get('reason')
        else:
            j = parse_full('{"verdict":"%s","progress":%s,"review":%s,'
                           '"decision":"%s","reason":"dry-run 模拟"}' % (
                               'abstain' if name.startswith('G1') else 'reject',
                               'null' if name.startswith('G1') else '72',
                               'null' if name.startswith('G1') else '55',
                               'escalate_human' if name.startswith('G1') else 'redo'))
            v, r = j.get('verdict'), j.get('reason')
        results.append((name, v, r))
    return results


if __name__ == '__main__':
    live = '--live' in os.sys.argv
    for name, v, r in dry_run(live=live):
        log.info('%-28s -> %-8s %s' % (name, v, r))
    log.info('DRY_RUN_DONE live=%s' % live)
