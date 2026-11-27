    // 按需加载注册表：mermaid 3.5MB 首次遇到流程图代码块才拉取（LazyLoader）
    // DOMPurify（HTML 消毒器，30KB）：md-render.js 启动时即触发加载，供全站 markdown 渲染净化原生 HTML。
    // 它是异步到达的——到达前 md-render 走严格兜底（从零重建标签，同样安全）。
    // v 值随 purify.min.js 升级而递增（长缓存靠它失效）。
    window.LAZY_SCRIPTS = {
        mermaid: { file: 'mermaid.min.js', v: '1' },
        DOMPurify: { file: 'purify.min.js', v: '3.5.0' }
    };