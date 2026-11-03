    // 启动时间+天气小组件
    if (window.App && App.zf3dCwInit) {
        (document.readyState === 'loading')
            ? document.addEventListener('DOMContentLoaded', function() { App.zf3dCwInit(); })
            : App.zf3dCwInit();
    }