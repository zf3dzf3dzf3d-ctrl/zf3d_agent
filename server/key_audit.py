# -*- coding: utf-8 -*-
"""
key_audit.py - API Key 启动体检（零新依赖，只读不改任何 Key 文件）
- 盘点：api_keys.json（模型 Key）+ internal_secret.txt（内部密钥），只记 名称+SHA256短哈希+加密状态，
  绝不输出 Key 明文，也绝不写回任何 Key 文件
- 体检项：明文 Key 检出（DPAPI 未加密）、空 Key、models.json 公开区夹带真实 Key、
  internal_secret 权限/存在性、近7天鉴权失败计数（zf_identity 审计流水）
- 入口：audit_keys() -> dict（供启动时/接口调用）；print_report() 打印人读报告
"""
import hashlib
import json
import os
import time

try:
    from config import BASE_DIR
except Exception:  # 独立脚本运行兜底
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

_KEYS_FILE = os.path.join(BASE_DIR, 'private', 'api_keys.json')
_MODELS_FILE = os.path.join(BASE_DIR, 'public', 'config', 'models.json')
_SECRET_FILE = os.path.join(BASE_DIR, 'private', 'internal_secret.txt')
_AUDIT_FILE = os.path.join(BASE_DIR, 'private', 'billing', 'zf_identity_audit.jsonl')

# 鉴权失败类事件名（zf_identity 审计）
_FAIL_EVENTS = {'internal_auth_fail', 'ticket_verify_fail', 'auth_fail'}


def _short_hash(val):
    """Key 指纹：SHA256 前 8 位。仅用于比对同一 Key 是否变化，不可反推原值。"""
    return hashlib.sha256(str(val or '').encode('utf-8')).hexdigest()[:8]


def _load_json(path, default):
    if not os.path.isfile(path):
        return default
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return default


def _week_ago_ms():
    return int((time.time() - 7 * 86400) * 1000)


def audit_keys():
    """执行体检，返回结构化报告。任何一步异常都被兜底，不影响启动。"""
    report = {
        'time': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'items': [],        # [{name, kind, encrypted, hash8, note}]
        'warnings': [],     # 人读警告
        'auth_fails_7d': 0,
        'ok': True,
    }
    try:
        import secure_store
        encrypted_flag = secure_store.is_encrypted
    except Exception:
        encrypted_flag = None

    # 1) api_keys.json 盘点（读原始密文判断加密状态，不落明文）
    data = _load_json(_KEYS_FILE, {'keys': {}})
    keys = data.get('keys') if isinstance(data, dict) else None
    meta = data.get('_meta') if isinstance(data, dict) else {}
    if not isinstance(keys, dict):
        keys = {}
    for name, val in keys.items():
        val = str(val or '')
        empty = (not val)
        item = {'name': str(name), 'kind': 'model_key',
                'encrypted': bool(encrypted_flag and encrypted_flag(val)),
                'hash8': _short_hash(val), 'empty': empty}
        report['items'].append(item)
        if empty:
            continue  # 空 Key 是「未配置」不是安全问题，不告警
        if not item['encrypted'] and val.startswith('sk-'):
            report['warnings'].append('Key「%s」为明文 sk- 存储（DPAPI 未加密），建议在设置里重新保存触发加密迁移' % name)
    if isinstance(meta, dict) and meta.get('encrypted') is False:
        report['warnings'].append('api_keys.json _meta.encrypted=False: 存在未能加密的条目(多为空Key或DPAPI不可用), 建议在设置里重新保存真实Key触发加密')

    # 2) models.json 公开区夹带真实 Key 检出
    models = (_load_json(_MODELS_FILE, {'models': []}) or {}).get('models') or []
    for m in models:
        if not isinstance(m, dict):
            continue
        k = str(m.get('key') or m.get('apiKey') or '')
        if k and not k.startswith('••••'):
            report['warnings'].append('公开区 models.json 中「%s」疑似夹带真实 Key（指纹 %s），'
                                      '应只留掩码，真实 Key 收进 private/api_keys.json' % (m.get('name'), _short_hash(k)))
            report['items'].append({'name': str(m.get('name')), 'kind': 'model_key_in_public_models',
                                    'encrypted': False, 'hash8': _short_hash(k)})

    # 3) internal_secret 存在性 + 基本强度
    if os.path.isfile(_SECRET_FILE):
        try:
            with open(_SECRET_FILE, 'r', encoding='utf-8') as f:
                sec = f.read().strip()
            report['items'].append({'name': 'internal_secret', 'kind': 'internal_secret',
                                    'encrypted': False, 'hash8': _short_hash(sec)})
            if len(sec) < 32:
                report['warnings'].append('internal_secret 长度不足 32 字符，建议删除后重启自动重新生成')
        except Exception:
            pass
    else:
        report['warnings'].append('internal_secret.txt 不存在：首次启动访问内部接口时会自动生成（属正常）')

    # 4) 近 7 天鉴权失败计数（读 zf_identity 审计流水，只统计不改动）
    try:
        cutoff = _week_ago_ms()
        if os.path.isfile(_AUDIT_FILE):
            with open(_AUDIT_FILE, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    if int(rec.get('ts') or 0) >= cutoff and str(rec.get('event')) in _FAIL_EVENTS:
                        report['auth_fails_7d'] += 1
        if report['auth_fails_7d'] >= 20:
            report['warnings'].append('近7天鉴权失败 %d 次，疑似被扫描/爆破，建议检查端口暴露面' % report['auth_fails_7d'])
    except Exception:
        pass

    report['ok'] = not report['warnings']
    return report


def print_report(report=None):
    """打印人读体检报告（供启动日志/CLI）。"""
    r = report or audit_keys()
    print('===== API Key 启动体检 %s =====' % r['time'])
    for it in r['items']:
        print('  [Key] %-24s kind=%-22s encrypted=%s hash8=%s'
              % (it['name'], it['kind'], it['encrypted'], it['hash8']))
    if r['auth_fails_7d']:
        print('  近7天鉴权失败: %d 次' % r['auth_fails_7d'])
    for w in r['warnings']:
        print('  [!] %s' % w)
    print('  体检结果: %s' % ('通过' if r['ok'] else '%d 条警告' % len(r['warnings'])))
    return r


if __name__ == '__main__':
    print_report()
