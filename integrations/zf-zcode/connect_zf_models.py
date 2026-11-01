# -*- coding: utf-8 -*-
"""
connect_zf_models.py — 一键把「朱峰模型」接入 ZCode（免人工设置）

原理：
  1. 探测本机朱峰 AI 网关（ai_proxy.py，端口读 public/config/ai_proxy.json，默认 8574）
  2. 拉取 /v1/models 真实模型列表
  3. 向 %USERPROFILE%\\.zcode\\v2\\config.json 注入 provider「zhufeng-models」
     （kind=openai 协议，baseURL=http://127.0.0.1:<port>/v1，apiKey 随意——本机回环免令牌）
  4. 幂等：已注入则更新模型列表；写前自动备份 config.json.bak-<时间戳>

用法： python connect_zf_models.py [--remove]
"""
import json
import os
import shutil
import sys
import time
import urllib.request

HOME = os.path.expanduser('~')
ZCODE_CFG = os.path.join(HOME, '.zcode', 'v2', 'config.json')
PROVIDER_ID = 'zhufeng-models'


def _proxy_port():
    """端口唯一事实来源：public/config/ai_proxy.json → private/port.json → 8574 兜底"""
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for rel in (os.path.join('public', 'config', 'ai_proxy.json'), os.path.join('private', 'port.json')):
        try:
            with open(os.path.join(base, rel), 'r', encoding='utf-8') as f:
                d = json.load(f)
            for k in ('ai_proxy_port', 'port', 'ai_proxy'):
                if str(d.get(k) or '').strip().isdigit():
                    return int(d[k])
        except Exception:
            pass
    return 8574


def _get(url, timeout=5):
    req = urllib.request.Request(url)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8', errors='replace'))


def main():
    if '--remove' in sys.argv:
        with open(ZCODE_CFG, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        removed = cfg.get('provider', {}).pop(PROVIDER_ID, None)
        with open(ZCODE_CFG, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        print(('✅ 已移除 ' if removed else 'ℹ️ 本就未注入 ') + PROVIDER_ID)
        return

    port = _proxy_port()
    base = f'http://127.0.0.1:{port}/v1'
    # 1. 探活 + 拉模型
    try:
        models = [m['id'] for m in _get(base + '/models').get('data', [])]
    except Exception as e:
        print('❌ 朱峰网关未就绪（%s/models：%s）。请先启动朱峰智能体服务端。' % (base, e))
        sys.exit(1)
    if not models:
        print('❌ 网关在线但模型列表为空')
        sys.exit(1)

    # 2. 注入/更新 provider
    if not os.path.isfile(ZCODE_CFG):
        print('❌ 未找到 ZCode 配置：%s（ZCode 是否安装过？）' % ZCODE_CFG)
        sys.exit(1)
    with open(ZCODE_CFG, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
    bak = ZCODE_CFG + '.bak-' + time.strftime('%Y%m%d_%H%M%S')
    shutil.copy2(ZCODE_CFG, bak)

    provs = cfg.setdefault('provider', {})
    existed = PROVIDER_ID in provs
    provs[PROVIDER_ID] = {
        'name': '朱峰模型（本机网关）',
        'kind': 'openai',
        'options': {'apiKey': 'local-free', 'baseURL': base},
        'source': 'custom',
        'enabled': True,
        'models': {mid: {
            'limit': {'context': 128000, 'output': 32000},
            'modalities': {'input': ['text'], 'output': ['text']},
            'zcode': {'modified': True, 'priority': 50},
        } for mid in models},
    }
    with open(ZCODE_CFG, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print('✅ %s 朱峰模型 provider（%d 个模型：%s）' % ('已更新' if existed else '已注入', len(models), ', '.join(models)))
    print('   备份：%s' % bak)
    print('   ▶ 请重启 ZCode，在模型选择里即可看到「朱峰模型（本机网关）」')


if __name__ == '__main__':
    main()
