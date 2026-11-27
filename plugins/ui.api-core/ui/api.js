/**
 * ZF API — 前端统一 API 封装（工程化整改 P1-4 · 20261123）
 * 背景：全站 556 处裸 '/api/...' 字符串散布 139 个文件，无统一超时/错误处置。
 * 约定：新代码一律走 API.*，存量 356 处裸 fetch 按文件随改随换，不做运动式替换。
 * 装载：经 ui.api-core 插件 ui.mount 注入（body 末尾，晚于页面脚本）——
 *       请在事件回调/懒初始化中调用 API.*，勿在页面顶层脚本立即调用。
 *
 * 用法:
 *   API.get('/api/xxx')                 -> Promise<any>        解析 JSON；非 2xx 抛 Error
 *   API.post('/api/xxx', {k:v})         -> Promise<any>        body 自动 JSON 序列化
 *   API.del('/api/xxx')                 -> Promise<any>
 *   API.raw('/api/xxx', init)           -> Promise<Response>   流式/SSE/原始响应时用
 * 选项（第三参/末参 opts）:
 *   timeout   毫秒，默认 15000；轮询类长请求可放大
 *   toast     失败是否弹全局提示，默认 true；轮询类调用建议传 false
 *   headers   自定义请求头（传了则覆盖默认 Content-Type）
 * 错误对象: err.status=HTTP 状态码, err.body=响应体（已尝试 JSON 解析）
 * 不做自动重试：幂等重试是业务层责任，避免重复下单类事故。
 */
(function (global) {
  'use strict';

  var DEFAULT_TIMEOUT = 15000;

  function toastOnce(msg) {
    try {
      var app = global.App;
      if (app && typeof app._showStormToast === 'function') app._showStormToast(msg);
    } catch (e) { /* toast 失败不影响主流程 */ }
  }

  function request(method, url, body, opts) {
    opts = opts || {};
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, opts.timeout || DEFAULT_TIMEOUT);
    var init = { method: method, signal: ctl && ctl.signal };
    if (opts.headers) {
      init.headers = opts.headers;
    } else if (body != null) {
      init.headers = { 'Content-Type': 'application/json' };
    }
    if (body != null) init.body = (typeof body === 'string') ? body : JSON.stringify(body);
    return fetch(url, init).then(function (resp) {
      if (timer) clearTimeout(timer);
      return resp.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        if (!resp.ok) {
          var err = new Error('API ' + resp.status + ': ' + url +
            (data && data.err ? ' — ' + data.err : ''));
          err.status = resp.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') {
        toastOnce('请求超时：' + url);
        throw new Error('API timeout: ' + url);
      }
      if (opts.toast !== false && !(e && e.status)) toastOnce('网络错误：' + url);
      throw e;
    });
  }

  global.API = {
    get: function (url, opts) { return request('GET', url, null, opts); },
    post: function (url, body, opts) { return request('POST', url, body, opts); },
    del: function (url, opts) { return request('DELETE', url, null, opts); },
    raw: function (url, init) { return fetch(url, init); }
  };
})(window);
