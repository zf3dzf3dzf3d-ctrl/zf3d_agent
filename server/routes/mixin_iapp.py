# -*- coding: utf-8 -*-
"""mixin_iapp.py - AI 统一调度入口 /api/iapp/*（2026-11-11，策划案 P1/S1.1）

设计：不做业务复制，纯回环转发到本机既有路由（127.0.0.1:PORT），原样回传。
白名单校验 app/op，禁止任意路径注入；GET 转发用 urllib，超时 15s。
挂载：handler_routes.py 追加 MixinIapp 基类。

【v3 2026-11-11 第2轮收口修复】
1. 删除幽灵接口 music/play（domain_music.py _h_music 无该分支，L294 兜底404）
   → 换成已实现的 bstream（注意：返回 audio/mpeg 流非 JSON）。
2. 表驱动映射：ops 改为 op->真实路径 全量枚举，废除 op.replace('_','/') 猜测兜底。
3. POST 协议级闸门：写操作必须带 confirmed=true，缺省返回引导 JSON（不再靠提示词自觉）。
4. POST body 直通：AI 可直接 POST JSON body 到 dispatch，原样转发给真实接口
   （解决 query 字符串无法表达 pages 数组的问题）；无 body 时回退 query 字符串并附警告。
【v4 2026-11-23 统一确认原语】confirmed 不再"请求自填即放行"：写操作即使带
confirmed=true 也须过 syscall 人工审批闸（工具名 iapp:<app>.<op>，与
engines/common/iapp_tools.py 共享同一审批记录）；未批准返回同构 need_confirm JSON。
help 文本同步去除"教模型自填 confirmed=true"旧协议措辞。
【维护纪律】本白名单是接口可发现性的单一真源；server 新增/删除 i* 路由必须同步回写。
"""
import json
import urllib.request
from config import PORT

# 白名单：app -> op -> 真实转发路径（全量显式枚举，无猜测映射）
_IAPP_ROUTES = {
    'comics': {
        'ops': {'sources': '/api/comics/sources',
                'list': '/api/comics/list',
                'chapters': '/api/comics/chapters',
                'pages': '/api/comics/pages',
                'download_status': '/api/comics/download/status',
                'progress': '/api/comics/progress'},
        'get_params': {'sources': '无参数',
                       'list': 'src=源ID',
                       'chapters': 'id=漫画ID&src=源ID',
                       'pages': 'id=&src=&ch=章节',
                       'download_status': '无参数',
                       'progress': 'id=漫画ID'},
        'post_ops': {'download_add': {'path': '/api/comics/download/add',
                                      'desc': '加入下载队列（写操作；确认由 syscall 人工审批闸收口，未批准返回 need_confirm）',
                                      'fields': 'mangaId=漫画ID(str), chapterId=章节ID(str), pages=页码数组(int[])'}},
    },
    'ivideo': {
        'ops': {'sites': '/api/ivideo/sites',
                'search': '/api/ivideo/search',
                'detail': '/api/ivideo/detail'},
        'get_params': {'sites': '无参数',
                       'search': 'wd=关键词',
                       'detail': 'site=站点ID&id=影视ID'},
        'post_ops': {},
    },
    'iimage': {
        'ops': {'sites': '/api/iimage/sites',
                'search': '/api/iimage/search'},
        'get_params': {'sites': '无参数',
                       'search': 'wd=关键词&page=1'},
        'post_ops': {},
    },
    'idol': {
        'ops': {'list': '/api/idol/list',
                'detail': '/api/idol/detail'},
        'get_params': {'list': '无参数',
                       'detail': 'id=偶像ID'},
        'post_ops': {
            'save': {'path': '/api/idol/save',
                     'desc': '建档/改偶像档案（写操作；确认由 syscall 人工审批闸收口，未批准返回 need_confirm）',
                     'fields': 'id=str, profile={name,aliases[],tags[],avatar}, sources[]?(可选)'},
            'media_add': {'path': '/api/idol/media/add',
                          'desc': '追加媒体条目；type=image 且 https 会自动归档落盘 private/idols（写操作）',
                          'fields': 'id=str, item={type:image|video|profile|news|biz|other, url, thumb?, title?, source_site?, source_url?, tags[]?, generated?}'},
        },
    },
    'music': {
        'ops': {'search': '/api/music/search',
                'song': '/api/music/song',
                'lyric': '/api/music/lyric',
                'bstream': '/api/music/bstream',
                'local': '/api/music/local'},
        'get_params': {'search': 'kw=关键词',
                       'song': 'kw=关键词（同search别名）',
                       'lyric': 'id=网易云歌曲ID',
                       'bstream': 'kw=关键词（返回MP3音频流，非JSON）',
                       'local': '无参数'},
        'post_ops': {},
    },
    'news': {
        'ops': {'list': '/api/news/list'},
        'get_params': {'list': '无参数'},
        'post_ops': {},
    },
}


class MixinIapp:
    def _iapp_help(self):
        return {'routes': {a: {'get_ops': m['get_params'],
                               'post_ops': {k: v['desc'] + ' | 字段: ' + v.get('fields', '') + ' | body直通: POST JSON 到 /api/iapp/dispatch?app=%s&op=%s（写操作无需也不接受任何确认参数，由 syscall 人工审批闸统一收口：未批准返回 need_confirm，人工批准后重试同一调用自动放行）' % (a, k)
                                            for k, v in m.get('post_ops', {}).items()}}
                           for a, m in _IAPP_ROUTES.items()},
                'usage': 'GET /api/iapp/dispatch?app=<名>&op=<操作>&<query参数透传>；POST 写操作=JSON body 直通（不带任何确认参数）：确认由 syscall 人工审批闸统一收口（工具名 iapp:<app>.<op>），未批准返回 need_confirm + 人工批准方式，批准后重试自动放行'}

    def _iapp_forward(self, url, payload=None):
        """回环转发到本机既有路由，原样回传 JSON。"""
        try:
            if payload is not None:
                data = json.dumps(payload).encode('utf-8')
                req = urllib.request.Request('http://127.0.0.1:%s%s' % (PORT, url), data=data,
                                             headers={'Content-Type': 'application/json'}, method='POST')
            else:
                req = urllib.request.Request('http://127.0.0.1:%s%s' % (PORT, url))
            with urllib.request.urlopen(req, timeout=15) as r:
                body = r.read().decode('utf-8', 'replace')
            try:
                return json.loads(body)
            except Exception:
                return {'ok': False, 'error': '非JSON回包', 'raw': body[:2000]}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def _iapp_read_body(self):
        """读取 JSON body（POST 直通用），无 body 返回 None。

        【连接黑洞修复 2026-11-25 bravo】do_POST 入口 _drain_body 已排干并缓存 body，
        此处裸读 rfile 会永久阻塞（与 c6ea724 修掉的 5 处同型；f803633 遗留项）。
        改走 _cached_body 缓存口径：入口未排干时缓存函数自带兜底读，两侧都安全。
        """
        try:
            n = int(self.headers.get('Content-Length') or 0)
            if n <= 0:
                return None
            raw = self._cached_body(n)
            return json.loads(raw.decode('utf-8', 'replace'))
        except Exception:
            return None

    def _handle_iapp_dispatch(self, qs):
        app = (qs.get('app', [''])[0] or '').strip()
        op = (qs.get('op', [''])[0] or '').strip()
        if not app or not op:
            self._send_json(self._iapp_help()); return
        m = _IAPP_ROUTES.get(app)
        if not m:
            self._send_json({'ok': False, 'error': '未知app: %s，可用: %s' % (app, list(_IAPP_ROUTES))}); return
        rest = {k: v[0] for k, v in qs.items() if k not in ('app', 'op')}
        if op in m['ops']:
            from urllib.parse import urlencode
            url = m['ops'][op] + (('?' + urlencode(rest)) if rest else '')
            self._send_json(self._iapp_forward(url)); return
        po = m.get('post_ops', {}).get(op)
        if po:
            # 【协议级闸门】写操作必须显式 confirmed=true，否则只回引导信息
            if rest.get('confirmed') != 'true':
                self._send_json({'ok': False, 'need_confirm': True,
                                 'error': '写操作 %s.%s 需人工审批后才可执行：写操作不接受调用方自填确认（confirmed 不取自请求参数），由 syscall 人工审批闸统一收口，批准后重试同一调用即可放行' % (app, op),
                                 'fields': po.get('fields', ''), 'path': po['path']}); return
            # 【v4 2026-11-23 统一确认原语】confirmed=true 也不再"自填即放行"：
            # 服务端再过一次 syscall 人工审批闸（工具名 iapp:<app>.<op>，与 AI 工具链
            # iapp_tools 共享同一审批记录，1 小时内免重复确认）。未批准返回与
            # iapp_tools 同构的 need_confirm JSON（含审批码推送）；闸不可用 fail-closed。
            # 直连面（本端点）无前端 UI 调用方（侦查 2026-11-23：public/js 仅
            # zf-app-dock.js GET /api/iapp/cmds 消费 + POST /api/iapp/event 埋点），
            # 故本地信任边界不受损；UI 直连的是底层真实接口（如 /api/idol/save）。
            try:
                from engines.common.iapp_tools import _sys_gate, _need_confirm_payload
                tool = 'iapp:%s.%s' % (app, op)
                ok, reason = _sys_gate(tool)
                if not ok:
                    self._send_json(_need_confirm_payload(tool, po.get('desc', '写操作'), reason)); return
            except Exception as e:
                self._send_json({'ok': False, 'need_confirm': True,
                                 'tool': 'iapp:%s.%s' % (app, op),
                                 'error': '写操作 %s.%s 需人工审批：审批闸不可用(%s)，fail-closed 拒绝' % (app, op, e)}); return
            # body 直通优先（支持数组等复杂类型）；无 body 时回退 query 字符串并警告
            body = self._iapp_read_body()
            if body is not None:
                payload = body
            else:
                payload = {k: v for k, v in rest.items() if k != 'confirmed'}
                payload['_warning'] = 'query字符串形态可能与目标接口不符（数组字段请改用 POST body 直通）'
            self._send_json(self._iapp_forward(po['path'], payload=payload)); return
        self._send_json({'ok': False, 'error': '未知op: %s，可用GET: %s POST: %s'
                             % (op, list(m['ops']), list(m.get('post_ops', {})))})
