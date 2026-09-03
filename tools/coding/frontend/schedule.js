// ========== schedule.js - Tool definition ==========
window.Tools = window.Tools || { allTools: {} };
if (!window.Tools.allTools.schedule) {
    window.Tools.allTools.schedule = {
        schedule: {
            type: 'function',
            function: {
                name: 'schedule',
                description: 'Run a shell command on a controlled schedule. Tasks can be stopped immediately, have a command timeout, and are limited to 10 concurrent tasks.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['start', 'stop', 'list', 'status'],
                            description: 'start a task, stop a task, list tasks, or get one task status'
                        },
                        name: {
                            type: 'string',
                            description: 'Unique task name; required for start, stop, and status'
                        },
                        code: {
                            type: 'string',
                            description: 'Shell command; required for start'
                        },
                        interval: {
                            type: 'number',
                            description: 'Delay between runs in seconds. Default 60; allowed range 0.5 to 86400.'
                        },
                        command_timeout: {
                            type: 'number',
                            description: 'Maximum duration of one command in seconds. Default 300; allowed range 1 to 3600.'
                        },
                        max_times: {
                            type: 'integer',
                            description: 'Maximum runs. 0 means repeat until stopped.'
                        },
                        stop_on_success: {
                            type: 'boolean',
                            description: 'Stop after a command exits with code 0.'
                        },
                        stop_on_output: {
                            type: 'string',
                            description: 'Stop when command output contains this text.'
                        }
                    },
                    required: ['action']
                }
            }
        }
    };
}
