# -*- coding: utf-8 -*-
"""route.collab：多路协作通气通道（策划案 v3.3 一期转正版）。

载入 collab_channel（通道骨架）与 collab_inject（hear 注入钩子）。
注入钩子为被动挂载：pool_worker.run_upstream 顶层的挂钩在本插件
sys.path 注入后 `from collab_inject import collab_hear_inject` 可达。

一期转正（v3.3 A1）：
  1. setup 即 cc.enable()（feature flag 常开；teardown 关，零残留等价）；
  2. ctx.http.route 挂 /api/plugin/collab/dispatch —— 派出建组接口：
     前端 ZFCollab.dispatch 调它拿 {team_id, members:[{codename,token,protocol_head}]}，
     然后逐窗开协作师窗并把 protocol_head 作为首条派单文本注入（per-lane，无全局串号）；
  3. ctx.event.on('agent.task_step') —— 若前端/服务端有任务步事件则合成更精确的 L1 提要；
  4. L1 心跳兜底在 collab_inject（每轮请求自动给同伴合成「进入新一轮」提要，服务器保证）。
"""
import json
import os
import sys


def setup(ctx):
    _here = os.path.dirname(os.path.abspath(__file__))
    if _here not in sys.path:
        sys.path.insert(0, _here)
    import collab_channel as cc
    import collab_inject  # noqa: F401  注入钩子（被 pool_worker 顶层挂钩调用）

    # 【一期转正】flag 常开（v3.3 A1；预演期默认关的历史使命完成）
    cc.enable()

    # ---- 派出建组 HTTP 接口（前端 ZFCollab.dispatch 的后端） ----
    def _dispatch_http(handler, path, parsed):
        body = {}
        parse_err = None
        try:
            ln = int(handler.headers.get('Content-Length', 0) or 0)
            # 【排干黑洞修复 2026-11-24】POST 入口 _drain_body 已把 body 读走并缓存，
            # 二次裸读 rfile.read 会因等不到数据永久阻塞（连接黑洞）——
            # 与 /api/external/config、/api/batch-ask、legacy#4 同款实锤，必须走缓存口径。
            raw = handler._cached_body(ln) if ln else b''
            body = json.loads(raw.decode('utf-8', 'ignore')) if raw else {}
            if not isinstance(body, dict):
                body, parse_err = {}, ValueError('body 须为 JSON 对象')
        except (ValueError, OSError) as _je:
            body, parse_err = {}, _je
        if parse_err is not None:
            out = json.dumps({'ok': False, 'error': 'body 解析失败: %s' % parse_err}, ensure_ascii=False).encode('utf-8')
            handler.send_response(200)
            handler.send_header('Content-Type', 'application/json; charset=utf-8')
            handler.send_header('Content-Length', str(len(out)))
            handler.end_headers()
            handler.wfile.write(out)
            return
        try:
            # 【v5.2 2026-11-24】热重载自愈·同 feed/bind 路由款：
            # 服务器进程存活但插件曾重载时，collab_channel 普通名缓存可能仍是旧版
            # （缺 _save_teams/_restore_teams 持久化）→ 组档案落盘静默失效、
            # 热重载后再派组又从零开始（用户实测：dispatch 成功但 state.json 不出现）。
            # 建组前探针自愈：缺持久化符号就地 reload，确保 v5.1 持久化在每次派出时生效。
            # 探针失败不拖垮建组（退化为旧版内存态行为，与历史一致）。
            try:
                if not hasattr(cc, '_save_teams'):
                    import importlib as _il
                    _il.reload(cc)
            except Exception as _pe:
                ctx.log.warning('[route.collab] dispatch 探针自愈失败(继续用旧通道): %s' % _pe)
            r = cc.dispatch(payload=body)
            out = json.dumps({'ok': True, **r}, ensure_ascii=False).encode('utf-8')
        except PermissionError as e:
            out = json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode('utf-8')
        except (KeyError, ValueError) as e:
            out = json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode('utf-8')
        except (PermissionError, KeyError, ValueError, TypeError) as e:
            # dispatch 的失败模式已枚举（见 collab_channel.dispatch）：flag 关 / 组员校验 / 参数校验 /
            # 脏字段类型（n 已在 dispatch 内钳制）。此外的异常不在此吞——交给宿主的顶层处理
            ctx.log.error('[route.collab] dispatch 内部错误: %s' % e)
            out = json.dumps({'ok': False, 'error': 'dispatch 内部错误: %s' % e}, ensure_ascii=False).encode('utf-8')
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(out)))
        handler.end_headers()
        handler.wfile.write(out)

    ctx.http.route('/api/plugin/collab/dispatch', _dispatch_http)

    # ---- v4.1 父子收口：collect 接口（父对话前端收口箭头点击时调，只读汇总） ----
    def _collect_http(handler, path, parsed):
        from urllib.parse import parse_qs
        qs = parse_qs(parsed.query or '')
        team_id = (qs.get('team_id') or [''])[0]
        try:
            r = cc.collect(team_id)
            out = json.dumps({'ok': True, **r}, ensure_ascii=False).encode('utf-8')
        except KeyError as e:
            out = json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode('utf-8')
        except PermissionError:
            # 【v4.9.1 修「服务器内部错误: PermissionError」2026-11-24】collect 首行 _require_on()
            # 在 flag 关闭时抛 PermissionError，旧路由只接 KeyError/ValueError/TypeError →
            # 穿透宿主顶层成 500（前端只显示裸异常名，无指引）。现降级为人话 + 唤醒指引：
            # 协作收尾（成员 set_ear/done 后组清档）会把 flag 关掉，属正常生命周期非故障；
            # 团队还没干完活时成员可用 collab(action=wakeup) 重开通道（与工具层同一口径）。
            out = json.dumps({'ok': False, 'error': '协作通道未启用（feature flag 关闭）——'
                              '组已收尾清档，收口汇总需先重建协作组再派单；'
                              '若团队还没干完活，成员可用 collab(action=wakeup, team=组id, codename=你的代号) 唤醒重组继续（口哨）'},
                             ensure_ascii=False).encode('utf-8')
        except (ValueError, TypeError) as e:
            out = json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode('utf-8')
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(out)))
        handler.end_headers()
        handler.wfile.write(out)

    ctx.http.route('/api/plugin/collab/collect', _collect_http, method="GET")

    # ---- 【v5 charlie 2026-11-24】眼·feed：协作师活体动态可视化只读聚合 ----
    # 前端 ZFCollab.startLiveFx 每 2.5s 轮询本接口，把全组实况渲染成
    # 「协作师活体头像」动画（思考脑脉冲/说话嘴开合/被插话耳抖/完成庆祝），
    # 让人类一眼看出每个协作师窗正在干什么。纯只读，零回执义务；
    # 组不存在/flag 关时返回 ok=False（前端静默降级），绝不抛 500。
    def _feed_http(handler, path, parsed):
        from urllib.parse import parse_qs
        qs = parse_qs(parsed.query or '')
        team = (qs.get('team') or [''])[0]
        try:
            since = float((qs.get('since') or ['0'])[0] or 0.0)
        except (ValueError, TypeError):
            since = 0.0
        try:
            # 【热重载自愈·同 bind 路由】reload 只 purge zfplugin_route_collab，
            # 普通名 collab_channel 若留旧缓存（无 feed），就地 reload 刷新，避免 AttributeError
            if not hasattr(cc, 'feed'):
                import importlib as _il
                _il.reload(cc)
            r = cc.feed(team_id=team, since_ts=since)
        except Exception as _fe:  # feed 兜底：任何异常都降级为人话，不让动态面板打死页面
            r = {'ok': False, 'error': 'feed 异常: %s' % _fe}
        out = json.dumps(r, ensure_ascii=False).encode('utf-8')
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(out)))
        handler.end_headers()
        handler.wfile.write(out)

    ctx.http.route('/api/plugin/collab/feed', _feed_http, method="GET")

    # ---- 【chat_id 回绑 v4.5】前端开窗后回绑真实窗 id（修成员 chat_id 全空） ----
    def _bind_http(handler, path, parsed):
        body = {}
        parse_err = None
        try:
            ln = int(handler.headers.get('Content-Length', 0) or 0)
            raw = handler._cached_body(ln) if ln else b''
            body = json.loads(raw.decode('utf-8', 'ignore')) if raw else {}
            if not isinstance(body, dict):
                body, parse_err = {}, ValueError('body 须为 JSON 对象')
        except (ValueError, OSError) as _je:
            body, parse_err = {}, _je
        if parse_err is not None:
            out = json.dumps({'ok': False, 'error': 'body 解析失败: %s' % parse_err}, ensure_ascii=False).encode('utf-8')
            handler.send_response(200)
            handler.send_header('Content-Type', 'application/json; charset=utf-8')
            handler.send_header('Content-Length', str(len(out)))
            handler.end_headers()
            handler.wfile.write(out)
            return
        try:
            # 【热重载自愈】reload 只 purge zfplugin_route_collab，普通名 collab_channel
            # 若还留旧缓存（无 bind_chats），就地 reload 刷新，避免 AttributeError
            if not hasattr(cc, 'bind_chats'):
                import importlib as _il
                _il.reload(cc)
            r = cc.bind_chats(team_id=str(body.get('team_id') or ''), binds=body.get('binds'))
            out = json.dumps({'ok': True, **r}, ensure_ascii=False).encode('utf-8')
        except PermissionError as e:
            out = json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode('utf-8')
        except (KeyError, ValueError, TypeError) as e:
            out = json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode('utf-8')
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(out)))
        handler.end_headers()
        handler.wfile.write(out)

    ctx.http.route('/api/plugin/collab/bind', _bind_http)

    # ---- 【v7.1 待命不脱网】义务查询（前端终局门禁数据源）：GET duties ----
    # 协作窗 task_complete 终局前查「组内还有没有我的义务」（未回应插话/同伴未收口），
    # 有义务 → 前端注入收尾协作指令继续循环；无义务 → 原样终局。纯只读零副作用；
    # 组不存在/flag 关时返回 ok=False + 空清单（前端按无义务终局），绝不抛 500。
    def _duties_http(handler, path, parsed):
        from urllib.parse import parse_qs
        qs = parse_qs(parsed.query or '')
        team = (qs.get('team') or [''])[0]
        cn = (qs.get('codename') or [''])[0]
        duties = []
        err = None
        try:
            # 【热重载自愈·同 feed/bind 路由】旧缓存无 get_duties 就地 reload
            if not hasattr(cc, 'get_duties'):
                import importlib as _il
                _il.reload(cc)
            duties = cc.get_duties(team_id=team, codename=cn) or []
        except Exception as _de:   # flag 关/组已清档 → 按无义务终局（终局门禁绝不拦死正常交付）
            err = str(_de)
            duties = []
        out = json.dumps({'ok': err is None, 'team_id': team, 'codename': cn,
                          'duties': duties, **({'error': err} if err else {})},
                         ensure_ascii=False).encode('utf-8')
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(out)))
        handler.end_headers()
        handler.wfile.write(out)

    ctx.http.route('/api/plugin/collab/duties', _duties_http, method="GET")

    # ---- 【v7.2 待命挂机】程序化待命登记（前端终局自动调，不靠模型自觉）：POST standby ----
    # 前端义务门禁放行后自动 POST 本路由 → 频道层 standby_report（幂等，done 保留、通道保持）。
    # 随后前端挂 _collabStandbyWatch 心跳轮询 duties，同伴插话自动拉窗回场。
    # 老流程零影响：不 POST 的窗行为不变；组不存在/flag 关 → ok=False（前端按正常终局）。
    def _standby_http(handler, path, parsed):
        try:
            _len = int(handler.headers.get('Content-Length') or 0)
            # 【连接黑洞修复 2026-11-25】POST 入口 _drain_body 已把 body 读走并缓存，
            # 二次裸读 rfile.read 会因等不到数据永久阻塞（连接黑洞）→ 前端同步 XHR
            # 主线程跟着永久锁死 → 整页卡死无法平移（重启必现，本机 2026-11-25 实锤）。
            # 与 L41 _dispatch_http 排干黑洞修复同款，必须走缓存口径。
            _body = json.loads((handler._cached_body(_len) or b'{}').decode('utf-8', 'ignore')) if _len > 0 else {}
        except Exception as _be:
            _body = {}
        team = str(_body.get('team') or '')
        cn = str(_body.get('codename') or '')
        result = None
        err = None
        try:
            # 【热重载自愈·同 duties 路由】旧缓存无 standby_report 就地 reload
            if not hasattr(cc, 'standby_report'):
                import importlib as _il
                _il.reload(cc)
            result = cc.standby_report(team_id=team, codename=cn)
        except Exception as _se:
            err = str(_se)
        out = json.dumps({'ok': err is None, 'team_id': team, 'codename': cn,
                          **({'standby': True, 'duties': result.get('duties', []), 'tip': result.get('tip', '')} if result else {}),
                          **({'error': err} if err else {})}, ensure_ascii=False).encode('utf-8')
        handler.send_response(200)
        handler.send_header('Content-Type', 'application/json; charset=utf-8')
        handler.send_header('Content-Length', str(len(out)))
        handler.end_headers()
        handler.wfile.write(out)

    ctx.http.route('/api/plugin/collab/standby', _standby_http, method="POST")

    # 【v4 §3.3 R4 合规】前端资源经 ui.mount 下发（/plugins-ui/ 静态通道，ui.demo 判例），
    # 不改 index.html、不加静态 <script>；window.ZFCollab 由该脚本全局定义。
    try:
        ctx.ui.mount('banner', ['ui/collab.js'])
    except (PermissionError, ValueError) as _me:
        # mount 的失败模式：能力缺失(_cap→PermissionError)/slot 非法(ValueError)
        ctx.log.warning('[route.collab] ui.mount 跳过: %s' % _me)

    # ---- 任务步事件 → L1 提要（有事件源时生效；无事件源时 collab_inject 心跳兜底） ----
    def _on_task_step(data):
        if not isinstance(data, dict):
            return
        # 节流/关耳/退场在 synth 内是返回值语义（不抛异常）；竞态类异常由事件总线隔离
        # （kernel_core.emit 对订阅者异常逐个捕获，不拖垮 emit 方）——“不阻断主链”由总线保证
        cc.synth_l1(str(data.get('team') or ''), str(data.get('codename') or ''),
                    str(data.get('brief') or ''))

    try:
        ctx.event.on('agent.task_step', _on_task_step)
    except PermissionError as _ee:
        # 事件挂载的唯一失败模式：能力缺失(_cap)；bus.on 本身不抛
        ctx.log.info('[route.collab] agent.task_step 事件挂载跳过: %s' % _ee)

    ctx.log.info('route.collab: 一期转正（flag on，dispatch 路由 + L1 心跳已挂）')


def teardown(ctx):
    try:
        import collab_channel as cc
        cc.disable()
    except ImportError:
        ctx.log.info('route.collab teardown: 通道模块不可用（可能已被卸载）')
    ctx.log.info('route.collab teardown（flag 已关，注册表由调用方 purge）')
