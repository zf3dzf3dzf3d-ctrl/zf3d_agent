// ==== 拆分自 app-agent.js：API 错误中文化翻译（_translateApiError） ====
// ========== app-agent.js - Agent循环/发送队列/工具卡片/ask_user ==========

// ===== 共用错误翻译：把英文 API 错误转为中文友好提示 =====
function _translateApiError(status, rawMsg) {
    var msg = rawMsg || '未知错误';
    // 尝试从 JSON 中提取 message
    var detail = '';
    try { var ej = JSON.parse(msg); detail = (ej.error && ej.error.message) || ej.message || ''; } catch(e) {
        try { detail = msg.match(/"message"\s*:\s*"([^"]+)"/)[1] || ''; } catch(e2) {}
    }
    if (detail) msg = detail;

    // 按 HTTP 状态码翻译
    if (status === 400) return '请求格式错误（400）：' + msg;
    if (status === 401) return 'API 密钥无效或未授权（401）：' + msg;
    if (status === 402) return '账户余额不足（402），请充值后重试。';
    if (status === 403) return '访问被拒绝（403）：' + msg;
    if (status === 404) return '接口地址不存在（404）：' + msg;
    if (status === 408) return '请求超时（408），请检查网络后重试。';
    if (status === 429) {
        var resetMatch = msg.match(/reset at\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})/i);
        var resetTime = resetMatch ? resetMatch[1] : '';
        if (/quota|TooManyRequests|AccountQuotaExceeded/i.test(msg)) {
            return 'API 额度已用尽（429 限流）' + (resetTime ? '，将在 ' + resetTime + ' 重置' : '') + '。请等待额度恢复或升级套餐。';
        }
        return '请求过于频繁被限流（429），请稍后重试。' + (resetTime ? '额度将在 ' + resetTime + ' 重置。' : '');
    }
    if (status === 500) return '服务器内部错误（500），请稍后重试。';
    if (status === 502) return '网关错误（502），上游服务不可用，请稍后重试。';
    if (status === 503) return '服务暂时不可用（503），请稍后重试。';
    if (status === 504) return '网关超时（504），请稍后重试。';
    if (status && status >= 500) return '服务器错误（' + status + '），请稍后重试。';

    // 通用英文关键词翻译
    if (/timeout|timed?\s*out/i.test(msg)) return '请求超时，请检查网络后重试。';
    if (/network|ENOTFOUND|ECONNREFUSED|ECONNRESET|EOF occurred|violation of protocol|SSL|TLS/i.test(msg)) return '网络连接失败（SSL/TLS 通信异常），请检查网络、代理或 API 服务后重试。';
    if (/aborted/i.test(msg)) return '请求被中断。';
    if (/model.*not\s*(found|support)/i.test(msg)) return '模型不可用或未授权：' + msg;
    if (/invalid\s*api\s*key|unauthorized/i.test(msg)) return 'API 密钥无效或未授权，请检查密钥配置。';
    if (/insufficient.*balance|quota/i.test(msg)) return '账户额度/余额不足，请充值或等待额度恢复。';

    if (status) return 'HTTP ' + status + '：' + msg;
    return msg;
}
