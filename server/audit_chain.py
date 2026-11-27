#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_chain.py - 四级隐私防护 P1-1：审计日志哈希链（第3级 监督网警的底座）

在 syscall.audit.jsonl 之外建立一条**带哈希链的敏感操作审计流**：
- 每条记录含 prev_hash（前一条的哈希），删除/篡改任意一条都会导致链条断裂可检测
- 记录类型：出域放行/拦截、紧急停止开关切换、private/ 加密读写、防护配置变更
- append-only：只追加不修改；verify() 从头重算链校验完整性

设计原则（与 syscall.py 一致）：
- 绝不抛错、绝不阻塞业务；文件追加带独立锁
- 零第三方依赖（hashlib），单文件自包含
- 环境变量 ZF_AUDIT_CHAIN=0 可静默关闭（不建议）
"""

import os
import io
import json
import time
import hashlib
import threading

_ENABLED = os.environ.get('ZF_AUDIT_CHAIN', '1') != '0'

_LOCK = threading.Lock()
_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    'private', 'logs', 'audit_chain.jsonl')

# 当前链尾哈希（内存缓存，重启时从文件尾回放恢复）
_prev_hash = None
_prev_loaded = False


def _load_prev():
    """启动后首次写入时，从日志尾部回放恢复链尾哈希。"""
    global _prev_hash, _prev_loaded
    if _prev_loaded:
        return
    _prev_loaded = True
    _prev_hash = ''
    try:
        if os.path.exists(_LOG):
            last = ''
            with io.open(_LOG, 'r', encoding='utf-8', errors='replace') as f:
                for line in f:
                    line = line.strip()
                    if line:
                        last = line
            if last:
                rec = json.loads(last)
                _prev_hash = rec.get('hash', '')
    except Exception:
        pass


_LOCKFILE = _LOG + '.lock'
_WARN_LOG = _LOG.replace('.jsonl', '.warn.log')  # 锁失败被拒记录的旁路告警流

def _file_lock(lockfile=None):
    """跨进程排它锁（Windows msvcrt.locking）。

    lockfile: 锁文件路径，默认主链锁文件；分数台账传独立路径避免争锁。
    返回 True=持锁成功；False=重试后仍失败（调用方必须拒绝写入，
    绝不允许降级为无锁写——那会导致哈希链分叉，正是历史破链根因）。
    """
    global _lock_fh
    if lockfile is None:
        lockfile = _LOCKFILE
    _lock_fh = None
    try:
        os.makedirs(os.path.dirname(lockfile), exist_ok=True)
        import msvcrt
        fh = io.open(lockfile, 'a+b')
        # LK_NBLCK 非阻塞探测 + 退避重试，避免 LK_LOCK 10秒超时异常后降级
        for i in range(4):  # 0/50/200/500ms
            if i:
                time.sleep((0.05, 0.2, 0.5)[i - 1])
            try:
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
                _lock_fh = fh
                return True
            except OSError:
                continue
        fh.close()
    except Exception:
        try:
            fh.close()
        except Exception:
            pass
    return False


def _file_unlock():
    try:
        import msvcrt
        if _lock_fh:
            _lock_fh.seek(0)
            msvcrt.locking(_lock_fh.fileno(), msvcrt.LK_UNLCK, 1)
            _lock_fh.close()
            _lock_fh = None
    except Exception:
        pass


def _warn_dropped(rec):
    """锁失败被拒的记录写入旁路告警流（不带链，仅供排查，不影响主链完整性）。"""
    try:
        with io.open(_WARN_LOG, 'a', encoding='utf-8') as f:
            f.write(json.dumps({'dropped': rec, 'ts': time.time()},
                               ensure_ascii=False) + '\n')
    except Exception:
        pass


def _iter_tail_chunks(path, chunk=8192):
    """从文件尾部按块倒序产出文本片段。"""
    size = os.path.getsize(path)
    pos = size
    with io.open(path, 'rb') as f:
        while pos > 0:
            step = min(chunk, pos)
            pos -= step
            f.seek(pos)
            yield f.read(step).decode('utf-8', 'replace')


def _last_line_of(path):
    """读文件最后一个非空行（seek 尾部倒序，日志大时 O(尾部) 而非 O(全文件)）。"""
    if not os.path.exists(path):
        return ''
    buf = ''
    for piece in _iter_tail_chunks(path):
        buf = piece + buf
        lines = buf.split('\n')
        # 已凑出完整末行（含换行分隔）或已读到文件头，即可判定
        if len(lines) >= 2 or os.path.getsize(path) <= 8192:
            for line in reversed(lines):
                line = line.strip()
                if line:
                    return line
            return ''
    return ''


def _read_tail_hash():
    """实时读文件末行取 hash（seek 尾部读取，跨进程一致，多进程并发写不破链）。"""
    try:
        last = _last_line_of(_LOG)
        if last:
            return json.loads(last).get('hash', '')
    except Exception:
        pass
    return ''


def _calc_hash(rec_no_hash):
    """对不含 hash 字段的记录计算链哈希：sha256(prev + json)。"""
    return hashlib.sha256(
        ((_prev_hash or '') + json.dumps(rec_no_hash, ensure_ascii=False,
                                         sort_keys=True)).encode('utf-8')
    ).hexdigest()


def record(kind, action, detail=None, actor='system', level='info'):
    """
    追加一条哈希链审计记录。任何异常静默吞掉，绝不影响业务。

    kind:   出域=egress / 紧急停止=killswitch / 加密存储=secure_store /
            防护配置=guard_config / 工具高危=tool_danger
    action: 动作名，如 'net_request' 'email_send' 'killswitch_on'
    detail: dict，附加细节（自动截断防膨胀；敏感字段请调用方先打码）
    actor:  触发者，如 engine_id / 'user' / 'system'
    level:  info / warn / block
    """
    if not _ENABLED:
        return
    try:
        _load_prev()
        rec = {
            'ts': round(time.time(), 3),
            'kind': str(kind)[:24],
            'action': str(action)[:60],
            'actor': str(actor or '')[:60],
            'level': str(level or 'info')[:12],
        }
        if detail:
            rec['detail'] = json.dumps(detail, ensure_ascii=False,
                                       default=str)[:600]
        with _LOCK:
            global _prev_hash
            # 跨进程文件锁：拿不到锁必须拒绝写入（宁缺勿断链），
            # 被拒记录写入旁路告警流供人工排查
            if not _file_lock():
                _warn_dropped(rec)
                return
            try:
                _prev_hash = _read_tail_hash()
                rec_no_hash = dict(rec)
                rec['prev_hash'] = _prev_hash or ''
                rec['hash'] = _calc_hash(rec_no_hash)
                _prev_hash = rec['hash']
                os.makedirs(os.path.dirname(_LOG), exist_ok=True)
                with io.open(_LOG, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            finally:
                _file_unlock()
    except Exception:
        pass


def repair_chain():
    """
    顺序重放全量记录、重算每条 prev_hash/hash（修复存量断裂）。
    用于：升级后长驻进程仍以旧逻辑写过链导致分叉的修复。
    返回 {'fixed': 重算条数, 'total': 总条数, 'verify_ok': bool}
    """
    fixed = 0
    lines = []
    try:
        if not os.path.exists(_LOG):
            return {'fixed': 0, 'total': 0, 'verify_ok': True}
        with io.open(_LOG, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if line:
                    lines.append(json.loads(line))
        prev = ''
        for rec in lines:
            body = {k: v for k, v in rec.items()
                    if k not in ('hash', 'prev_hash')}
            h = hashlib.sha256(
                (prev + json.dumps(body, ensure_ascii=False,
                                   sort_keys=True)).encode('utf-8')
            ).hexdigest()
            if rec.get('hash') != h or rec.get('prev_hash') != prev:
                fixed += 1
            rec['prev_hash'] = prev
            rec['hash'] = h
            prev = h
        if fixed:
            with _LOCK:
                if not _file_lock():
                    return {'fixed': 0, 'total': len(lines),
                            'verify_ok': False, 'error': 'lock_failed'}
                try:
                    bak = _LOG + '.brokenbak'
                    if os.path.exists(bak):
                        os.remove(bak)
                    os.rename(_LOG, bak)
                    with io.open(_LOG, 'w', encoding='utf-8') as f:
                        for rec in lines:
                            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
                finally:
                    _file_unlock()
            global _prev_hash
            _prev_hash = prev
        v = verify()
        return {'fixed': fixed, 'total': len(lines), 'verify_ok': v['ok']}
    except Exception as e:
        return {'fixed': fixed, 'total': len(lines), 'verify_ok': False,
                'error': str(e)[:200]}


def verify(max_lines=None):
    """
    从头校验整条哈希链，返回 {'ok': bool, 'total': int,
    'broken_at': 第几条(1起，ok时为0), 'checked': 实际校验条数}。
    """
    result = {'ok': False, 'total': 0, 'broken_at': 0, 'checked': 0}
    try:
        if not os.path.exists(_LOG):
            result['ok'] = True
            return result
        prev = ''
        n = 0
        with io.open(_LOG, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                n += 1
                try:
                    rec = json.loads(line)
                except Exception:
                    result['broken_at'] = n
                    return result
                h = rec.pop('hash', None)
                ph = rec.pop('prev_hash', None)
                expect = hashlib.sha256(
                    (prev + json.dumps(rec, ensure_ascii=False,
                                       sort_keys=True)).encode('utf-8')
                ).hexdigest()
                if h != expect or ph != prev:
                    result['broken_at'] = n
                    result['total'] = n
                    result['checked'] = n
                    return result
                prev = h
                result['checked'] = n
                if max_lines and n >= max_lines:
                    break
        result['ok'] = result['broken_at'] == 0
        result['total'] = n
        return result
    except Exception as e:
        result['error'] = str(e)[:120]
        return result


def status():
    """快速状态：日志是否存在、条数、链尾哈希前12位。"""
    try:
        if not os.path.exists(_LOG):
            return {'exists': False, 'lines': 0}
        tail = ''
        last = _last_line_of(_LOG)
        if last:
            tail = json.loads(last).get('hash', '')[:12]
        return {'exists': True, 'tail': tail}
    except Exception as e:
        return {'exists': True, 'error': str(e)[:120]}


def log_path():
    return _LOG


# ============================================================================
# 职位分数台账（P0-②，DSH v2.1 裁决：与安全审计分文件，防高频评分污染主链）
# 独立文件 audit_scores.jsonl + 独立哈希链，复用同一套跨进程锁/尾部读取逻辑。
# 锁审计说明：_SCORE_LOCK 全程持锁调用 _file_lock/_file_unlock（内含独立锁文件
# _SCORE_LOG + '.lock'，与主链锁文件不同），无持锁重入风险。
# ============================================================================

_SCORE_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'private', 'logs', 'audit_scores.jsonl')
_SCORE_LOCK = threading.Lock()


def record_score(role, score, subject, detail=None, actor='system'):
    """追加一条职位评分台账记录（独立通道，失败落旁路告警不静默）。

    role:    评分职位，必须命中 ROLE_WHITELIST（防伪造 role 绕过交叉评分）
    score:   分数 0~100（非数值自动取 0；越界自动 clamp 到 [0,100]）
    subject: 被评对象，如 任务名/文件名/节点id
    detail:  dict 附加细节（截断 600 字符；敏感字段调用方先打码）
    actor:   评分者 engine_id / 'system'
    """
    if not _ENABLED:
        return
    # 防伪造 role：白名单外职位拒写，落旁路告警供排查
    role_clean = str(role or '').strip()
    if role_clean not in ROLE_WHITELIST:
        _warn_dropped({'rejected_role': role_clean, 'subject': str(subject or '')[:120],
                       'reason': 'role_not_in_whitelist', 'ts': round(time.time(), 3)})
        return
    try:
        s = float(score)
    except Exception:
        s = 0.0
    s = max(0.0, min(100.0, s))  # clamp：越界分数不落链（安全师收口意见）
    try:
        rec = {
            'ts': round(time.time(), 3),
            'kind': 'score',
            'role': role_clean[:24],
            'score': round(s, 1),
            'subject': str(subject or '')[:120],
            'actor': str(actor or '')[:60],
        }
        if detail:
            rec['detail'] = json.dumps(detail, ensure_ascii=False,
                                       default=str)[:600]
        with _SCORE_LOCK:
            if not _file_lock(_SCORE_LOG + '.lock'):  # 独立锁文件，不与主链争锁
                _warn_dropped(rec)
                return
            try:
                prev = _last_line_of(_SCORE_LOG)
                prev_hash = ''
                if prev:
                    try:
                        prev_hash = json.loads(prev).get('hash', '')
                    except Exception:
                        prev_hash = ''
                body = dict(rec)
                body['prev_hash'] = prev_hash
                rec['prev_hash'] = prev_hash
                rec['hash'] = hashlib.sha256(
                    (prev_hash + json.dumps(body, ensure_ascii=False,
                                            sort_keys=True)).encode('utf-8')
                ).hexdigest()
                os.makedirs(os.path.dirname(_SCORE_LOG), exist_ok=True)
                with io.open(_SCORE_LOG, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            finally:
                _file_unlock()
    except Exception as e:
        # 旁路告警替代裸 except: pass（代码师收口 Step1：静默失败须可发现）
        try:
            _warn_dropped({'score_write_error': str(e)[:200],
                           'subject': str(subject or '')[:120],
                           'ts': round(time.time(), 3)})
        except Exception:
            pass


def scores_log_path():
    """返回分数台账文件路径（供前端/查询接口使用）。"""
    return _SCORE_LOG


# 评分职位白名单：与十三师协议对齐；白名单外 role 拒写入台账（防伪造 role
# 绕过 check_evolutions 的交叉评分防线）。新增职位须先在此登记。
ROLE_WHITELIST = frozenset({
    '验证师', '代码师', '安全师', '优化师', '进化师', '策划师',
    '审核员', '反驳师', '记忆师', '文档师', '测试师', '运维师', '架构师', '突破师', '推进师',
})


def is_valid_role(role):
    return str(role or '').strip() in ROLE_WHITELIST
