# -*- coding: utf-8 -*-
"""pool_resume：池任务断点持久化——重启后自动续跑中断的 Turn（无缝衔接）。

原理：
  每轮 Turn 在池内启动时，把 (slot_id, turn_id, body) 原子落盘到
  private/chat_pool_resume.json；正常结束/取消/被取代时删除该条目。
  服务器异常重启后，文件里剩下的就是"死前还在跑"的 Turn。
  启动时 recover() 延迟数秒把这些 Turn 用【同一 turn_id】重投池内
  （submit 的幂等语义保证不产生新代次），前端拿原 cursor 重连
  /api/chat-pool/slot/<id>/events 即可无缝续播——上下文无感。

注意：
  - body 里已含完整上游请求参数（_target_url/_body 等），重投即重跑本轮。
  - 只保留最近 60 分钟内的条目，防止陈旧任务无限重投。
  - 恢复线程由 server.py 启动时触发一次（recover_on_boot）。
"""
import json
import os
import threading
import time

_BASE = os.path.dirname(os.path.abspath(__file__))
_RESUME_PATH = os.path.join(_BASE, 'private', 'chat_pool_resume.json')
_LOCK = threading.Lock()
_MAX_AGE_SEC = 3600          # 超过 1 小时的中断任务不再自动续跑
_MAX_RETRY = 1               # 同一 Turn 最多自动重投次数（防僵尸任务反复续跑、烧 token）
_RECOVER_DELAY_SEC = 4.0     # 启动后等路由/配置就绪再重投


def _load():
    try:
        # utf-8-sig：兼容曾被带 BOM 工具改写过的文件（BOM 会让 json.load 抛异常，
        # _load 静默返回 {} 导致续跑/过期清理全部失效）
        with open(_RESUME_PATH, 'r', encoding='utf-8-sig') as f:
            return json.load(f) or {}
    except Exception:
        return {}


def _save(data):
    tmp = _RESUME_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    # Windows 下 os.replace 目标文件被其他线程短暂占用（如杀软/并发读）会抛
    # PermissionError(WinError 5)，加退避重试 3 次兜底
    last_err = None
    for _i in range(3):
        try:
            os.replace(tmp, _RESUME_PATH)
            last_err = None
            break
        except PermissionError as e:
            last_err = e
            time.sleep(0.05 * (_i + 1))
    if last_err is not None:
        raise last_err


def mark_running(slot_id, turn_id, body):
    """Turn 启动：登记可恢复快照（原子写，进程死也能留下）。"""
    if not slot_id or not turn_id or not isinstance(body, dict) or str(turn_id) == 'None':
        return
    try:
        with _LOCK:
            d = _load()
            d[str(turn_id)] = {'slot_id': str(slot_id), 'ts': time.time(),
                               'body': body}
            _save(d)
    except Exception as e:
        print('[PoolResume] mark_running 失败: %s' % e)


def mark_done(turn_id):
    """Turn 终态（done/failed/cancelled/superseded）：移除登记。"""
    if not turn_id or str(turn_id) == 'None':
        return
    try:
        with _LOCK:
            d = _load()
            changed = False
            if str(turn_id) in d:
                del d[str(turn_id)]
                changed = True
            # 清理历史脏数据：turn_id 为空时曾被字符串化成 "None" 存入，
            # 导致每次重启都被当作中断任务捞起重投（空转烧 token）。
            if 'None' in d:
                del d['None']
                changed = True
            if changed:
                _save(d)
    except Exception:
        pass


def _recover_one(entry):
    """重投一个中断 Turn（同 turn_id 幂等重投）。返回是否成功入池。
    【自动发继续】重启重投时若原样重发，上游往往复刻上次失败/半截响应；
    因此给 _body.messages 追加一条"继续"用户消息，让模型从断点接着干。
    已追加过的条目（重启多次）不重复追加。"""
    try:
        import chat_pool
        body = entry.get('body') or {}
        if not body.get('_target_url'):
            return False
        # ===== 自动发"继续"：仅当该条目尚未注入过 =====
        if not entry.get('_continued'):
            try:
                msgs = ((body.get('_body') or {}).get('messages'))
                if isinstance(msgs, list) and msgs:
                    msgs.append({'role': 'user',
                                 'content': ('（系统自动续跑提示）服务器刚刚重启，上面的任务执行到一半被打断了。'
                                             '请不要重复已完成的工作，从断点处继续完成任务；'
                                             '若已无未完成事项，直接给出最终回答。')})
                    entry['_continued'] = True
                    with _LOCK:
                        d = _load()
                        d[str(entry.get('turn_id'))] = entry
                        _save(d)
                    print('[PoolResume] 已为 Turn %s 注入"继续"续跑提示' % str(entry.get('turn_id'))[-12:])
            except Exception as _ie:
                print('[PoolResume] 注入继续提示失败(仍按原样重投): %s' % _ie)
        resp = chat_pool.submit(body, str(entry.get('turn_id') or ''))
        return bool(resp.get('ok'))
    except Exception as e:
        print('[PoolResume] 重投 Turn %s 失败: %s'
              % (str(entry.get('turn_id'))[-12:], e))
        return False


def recover_on_boot():
    """服务器启动时调用（非阻塞）：延迟数秒后扫描并续跑全部中断任务。"""
    def _run():
        time.sleep(_RECOVER_DELAY_SEC)
        with _LOCK:
            d = _load()
        now = time.time()
        picked = {tid: e for tid, e in d.items()
                  if now - float(e.get('ts') or 0) <= _MAX_AGE_SEC}
        stale = [tid for tid in d if tid not in picked]
        if stale:
            # 清掉过期条目
            with _LOCK:
                cur = _load()
                for tid in stale:
                    cur.pop(tid, None)
                _save(cur)
        if not picked:
            return
        print('[PoolResume] 检测到 %d 个中断任务，开始自动续跑…' % len(picked))
        done_ids = []
        skipped = []
        for tid, e in picked.items():
            # ===== 重投次数上限：超过则放弃并清除（防僵尸任务无限续跑）=====
            if int(e.get('_retries') or 0) >= _MAX_RETRY:
                skipped.append(tid)
                print('[PoolResume] Turn %s 已重投 %d 次仍未完成，放弃自动续跑（可手动处理）'
                      % (str(tid)[-12:], int(e.get('_retries') or 0)))
                continue
            if _recover_one(e):
                e['_retries'] = int(e.get('_retries') or 0) + 1
                done_ids.append(tid)
                print('[PoolResume] Turn %s 已重投（同 id 幂等，前端重连即续播）'
                      % str(tid)[-12:])
            else:
                # 重投失败（如池未开启）→ 保留条目下次重启再试；但过期清理兜底
                print('[PoolResume] Turn %s 重投失败，保留待下次' % str(tid)[-12:])
        if skipped:
            # 放弃续跑的条目：直接从登记中移除，避免下次重启又被捞起
            with _LOCK:
                cur = _load()
                for tid in skipped:
                    cur.pop(tid, None)
                _save(cur)
        if done_ids:
            with _LOCK:
                cur = _load()
                for tid in done_ids:
                    # 已重投成功：由 mark_done 在其终态时移除；此处不动，
                    # 避免误删后进程再崩丢失可恢复性
                    if tid in cur and cur[tid].get('_retries'):
                        pass  # 保留 _retries 计数，供下次重启判断
                _save(cur)
        print('[PoolResume] 续跑扫描完成。')
    threading.Thread(target=_run, name='pool-resume-recover',
                     daemon=True).start()
