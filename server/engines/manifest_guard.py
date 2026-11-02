#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
manifest_guard.py - 引擎/扩展 manifest 加载门禁（阶段一·借鉴 DSB 报告）

目的：扩展装得上但跑不了（缺依赖/缺必需服务要到运行时才暴露）→
     启动/扫描期就校验 manifest 声明，缺什么直接给出明确拒绝原因。

模式（环境变量 ZF_GUARD_MODE 控制）：
  - warn （默认，过渡期）：问题只打印告警，不阻断加载（先告警后收紧）
  - reject：校验不通过 → 拒绝该引擎注册，其余引擎照常（fail-closed 单体，不崩整个 server）

manifest 可选声明字段：
  "requires": {
      "min_version": "1.0.0",        # 门禁自身版本要求
      "env": ["ZF_PYCONSOLE"],       # 必需环境变量
      "services": ["engines"],       # 必需服务名（engines/routes/extensions）
      "modules": ["yaml"]            # 必需 Python 模块
  }

激活报告：get_activation_report() 返回本次扫描的全部判定结果，供 boot 矩阵/HTTP 暴露。
"""

import os
import sys
import importlib

_GUARD_VERSION = '1.0.0'
# 本进程内最近一次扫描的判定结果：[{engine, ok, reasons[], mode}]
_LAST_REPORT = []

# 已知必需服务名 → 探测函数
_SERVICES = {
    'engines': lambda: os.path.isdir(os.path.dirname(os.path.abspath(__file__))),
    'extensions': lambda: _importable('extensions'),
    'routes': lambda: _importable('server.routes') or _importable('routes'),
}


def _importable(name):
    try:
        importlib.import_module(name)
        return True
    except Exception:
        return False


def _guard_mode():
    m = (os.environ.get('ZF_GUARD_MODE') or 'warn').strip().lower()
    return m if m in ('warn', 'reject') else 'warn'


def _ver_tuple(v):
    try:
        return tuple(int(x) for x in str(v).split('.'))
    except ValueError:
        return (0,)


def check_manifest(name, m):
    """校验单个 manifest，返回 reasons 列表（空 = 通过）。"""
    reasons = []
    if not isinstance(m, dict):
        return ['manifest 不是 JSON 对象']
    if not str(m.get('id') or '').strip():
        reasons.append('manifest 缺少 id')
    elif str(m.get('id')).strip() != name:
        reasons.append('manifest.id=%r 与目录名 %r 不一致' % (m.get('id'), name))
    if not m.get('name'):
        reasons.append('manifest 缺少 name')
    if not str(m.get('version') or '').strip():
        reasons.append('manifest 缺少 version（建议语义化版本，便于门禁与留痕）')

    req = m.get('requires')
    if isinstance(req, dict):
        min_v = str(req.get('min_version') or '').strip()
        if min_v and _ver_tuple(_GUARD_VERSION) < _ver_tuple(min_v):
            reasons.append('需要门禁版本 >= %s，当前 %s' % (min_v, _GUARD_VERSION))
        for env_name in (req.get('env') or []):
            if str(env_name) not in os.environ:
                reasons.append('缺少必需环境变量 %s' % env_name)
        for svc in (req.get('services') or []):
            probe = _SERVICES.get(str(svc))
            if probe is None:
                reasons.append('未知必需服务 %r（可用: %s）' % (svc, ','.join(sorted(_SERVICES))))
            elif not probe():
                reasons.append('必需服务 %s 不可用' % svc)
        for mod in (req.get('modules') or []):
            if not _importable(str(mod)):
                reasons.append('缺少必需 Python 模块 %s' % mod)
    elif req is not None:
        reasons.append('requires 字段必须是对象')
    return reasons


def guard_scan(entries, read_manifest):
    """
    引擎扫描门禁入口。engines_loader._scan() 逐目录调用本函数替代裸读。

    entries:        [(name, manifest_json_path_or_None)] 候选列表
    read_manifest:  callable(path) -> dict|None
    返回:           {engine_id: manifest}（按模式过滤）
    并填充 _LAST_REPORT。
    """
    global _LAST_REPORT
    mode = _guard_mode()
    report = []
    accepted = {}
    for name, mpath in entries:
        if mpath is None:
            report.append({'engine': name, 'ok': False, 'reasons': ['缺少 manifest.json 或 engine.py'], 'mode': mode})
            continue
        m = read_manifest(mpath)
        if not m:
            report.append({'engine': name, 'ok': False, 'reasons': ['manifest 无法解析'], 'mode': mode})
            continue
        reasons = check_manifest(name, m)
        ok = not reasons
        report.append({'engine': name, 'ok': ok, 'reasons': reasons, 'mode': mode})
        if ok:
            accepted[str(m.get('id')).strip()] = m
        elif mode == 'warn':
            accepted[str(m.get('id') or name).strip()] = m  # 过渡期放行但留告警
    _LAST_REPORT = report
    for r in report:
        if not r['ok']:
            tag = 'GUARD-REJECT' if (mode == 'reject' and r['engine'] not in accepted) else 'GUARD-WARN'
            print('[Engines] %s: %s -> %s' % (tag, r['engine'], '; '.join(r['reasons'])))
    return accepted


def get_activation_report():
    """返回最近一次扫描的激活报告（boot 矩阵用）。"""
    return list(_LAST_REPORT)


if __name__ == '__main__':
    # 自检：对当前引擎目录跑一遍门禁
    d = os.path.dirname(os.path.abspath(__file__))
    ents = []
    for n in sorted(os.listdir(d)):
        sub = os.path.join(d, n)
        mp = os.path.join(sub, 'manifest.json')
        if os.path.isdir(sub) and os.path.isfile(mp):
            ents.append((n, mp))
    import json as _json
    def _rm(p):
        try:
            with open(p, 'r', encoding='utf-8-sig') as f:
                v = _json.load(f)
            return v if isinstance(v, dict) else None
        except Exception:
            return None
    for e in guard_scan(ents, _rm):
        print(e)
