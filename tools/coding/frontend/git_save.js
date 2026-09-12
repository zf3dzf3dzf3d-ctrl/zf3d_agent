// ========== git_save.js - 工具定义 ==========
// 朱峰社区智能体无限 5.0.0 - 独立工具文件
// 自动生成自 4.1.8 tools.js（split_tools.js V3）
// 执行逻辑: tools/executor.js 中对应 case 分支

window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools['git_save']) {
    window.Tools.allTools['git_save'] = {
    git_save: {
        type: 'function',
        function: {
            name: 'git_save',
            description: 'Git 保存（git add -A + commit）。可选 push。返回结果和最近 commit。',
            parameters: {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        description: '提交信息（commit message）。省略时自动生成 "auto: git save @ 时间"'
                    },
                    path: {
                        type: 'string',
                        description: 'Git 仓库路径，默认为项目根目录'
                    },
                    push: {
                        type: 'boolean',
                        description: '是否在 commit 后执行 git push，默认 false'
                    }
                },
                required: []
            }
        }
    },
    };
}
