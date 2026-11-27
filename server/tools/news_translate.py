# -*- coding: utf-8 -*-
"""新闻英文标题批量翻译：走 zf3d 官方中转 (glm-5.3-flash)，复用 heartbeat 鉴权。
用法：from news_translate import translate_titles; translate_titles(items)
- 只翻不含中文的标题；译文写入 item['title_zh']，原文保留 item['title']
- 单条失败静默跳过（标题保留原文），不阻断采集
- 批量合并翻译（每批 8 条编号对应），减少请求数
"""
import json
import os
import re
import sys
import urllib.request

from util_log import get_logger

log = get_logger('news_translate')
_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if os.path.join(_BASE, 'server') not in sys.path:
    sys.path.insert(0, os.path.join(_BASE, 'server'))

MODEL = 'glm-5.3-flash'
RELAY = 'https://www.zf3d.com/api/zf_models_relay.asp?model=' + MODEL
BATCH = 8
MAX_TOKENS = 2000  # glm-5.3-flash 为推理模型，思考占 token，需给足

_CN_RE = re.compile(r'[\u4e00-\u9fff]')


def _has_cn(s):
    return bool(_CN_RE.search(s or ''))


def _relay_chat(messages, timeout=90):
    from zf3d_commands import _get_api_key
    from zf3d_heartbeat import _get_login_status
    key = _get_api_key() or ''
    _ls, _lu, uid = _get_login_status()
    payload = json.dumps({'model': MODEL, 'messages': messages,
                          'max_tokens': MAX_TOKENS}).encode('utf-8')
    req = urllib.request.Request(RELAY, data=payload, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'X-ZF-Key': key,
        'X-ZF-User': str(uid or 0),
        'User-Agent': 'Mozilla/5.0'})
    r = urllib.request.urlopen(req, timeout=timeout)
    d = json.loads(r.read().decode('utf-8', 'replace'))
    msg = (d.get('choices') or [{}])[0].get('message', {})
    return msg.get('content') or ''


def _parse_lines(text):
    """从模型输出里抽编号行 → {1: '译文', ...}"""
    out = {}
    for line in (text or '').splitlines():
        m = re.match(r'\s*(\d{1,2})\s*[.、:：)\]]\s*(.+)', line.strip())
        if m and m.group(2).strip():
            out[int(m.group(1))] = m.group(2).strip().strip('"“”')
    return out


def translate_titles(items, limit=40):
    """给不含中文的条目标题补中文翻译 title_zh。返回翻译成功条数。"""
    todo = [it for it in items if not _has_cn(it.get('title'))][:limit]
    if not todo:
        return 0
    done = 0
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i + BATCH]
        listing = '\n'.join('%d. %s' % (j + 1, it['title']) for j, it in enumerate(chunk))
        prompt = ('将下列 %d 条英文新闻标题分别翻译成简体中文新闻标题风格。'
                  '只输出编号+译文，格式：1. 译文。不要任何解释。\n%s' % (len(chunk), listing))
        try:
            resp = _relay_chat([{'role': 'user', 'content': prompt}])
        except Exception as e:
            log.error('[translate] 批次失败: %r' % e)
            continue
        mapping = _parse_lines(resp)
        for j, it in enumerate(chunk):
            zh = mapping.get(j + 1)
            if zh and not _has_cn(zh) is False:  # 译文应为中文
                if _has_cn(zh):
                    it['title_zh'] = zh
                    done += 1
    log.info('[translate] 翻译完成 %d/%d 条' % (done, len(todo)))
    return done


if __name__ == '__main__':
    # 自测
    demo = [{'title': 'Global markets tumble as central banks signal rate shifts'},
            {'title': '这是已是中文的标题不应翻译'}]
    n = translate_titles(demo)
    for it in demo:
        log.info(it.get('title_zh', it['title']))
    log.info('%s %s', 'translated:', n)
