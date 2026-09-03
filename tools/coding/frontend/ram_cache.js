// ========== ram_cache.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['ram_cache']) {
    window.Tools.allTools['ram_cache'] = {
    ram_cache: {
        type: 'function',
        function: {
            name: 'ram_cache',
            description: '内存缓存管理（纯内存，不落盘，读写极快）。set=写入键值对，get=读取值，delete=删除键，clear=清空全部，list=列出所有键，has=检查键是否存在。适合编程时临时缓存中间结果、传递数据、记录状态。重启后清空。',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', enum: ['set', 'get', 'delete', 'clear', 'list', 'has'], description: '操作类型：set=写入，get=读取单个或多个，delete=删除单个或多个键，clear=清空全部，list=列出所有键，has=检查单个或多个键是否存在' },
                    key: { type: 'string', description: '缓存键名（set/get/delete/has 单个操作时用，与 keys 二选一）' },
                    keys: { type: 'array', items: { type: 'string' }, description: '缓存键名数组（get/delete/has 批量操作时用，与 key 二选一）' },
                    value: { type: 'string', description: '缓存值（set 时必填）' },
                    ttl: { type: 'integer', description: '存活秒数，超时自动失效（set 时可选，0=永久）' }
                },
                required: ['action']
            }
        }
    },

    // ===== AI 像素显示器工具（向左下角固定面板发送像素图/动画） =====
    // PXL 格式 v2：
    //   静态图: WxHB:RLE        例: 16x16B:36,2,3,2,...
    //   动画:   WxHB F帧数:RLE1|RLE2|...   例: 16x16B F2:36,2,...|16,16,...
    //   带fps:  WxHB F帧数@fps:RLE1|RLE2|... 例: 16x16B F4@8:...|...|...|...
    //   fps默认4，动画自动循环播放
    };
}
