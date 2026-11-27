# -*- coding: utf-8 -*-
"""
util_log —— 服务端统一日志框架（工程基建总纲 P1.6 20261123）。

【定位】新代码一律走本框架，禁止再新增 print 当日志（计数器盯 server/ 的
print 增量，只许降）；存量 print 的迁移随 Phase 2.2 分批进行。

用法（模块内两行）：
    from util_log import get_logger
    log = get_logger('chat_gate')
    log.info('...'); log.warning('...'); log.exception('上下文')  # exception 自动带栈

产出：
    logs/zf-server.log        统一轮转文件（5MB×3），格式含 时间/级别/模块/行号
    控制台                    简洁格式；config.QUIET_CONSOLE=True 时静音

幂等：重复调用 setup 不会叠加 handler（多次 import 安全）。
自检：py server/util_log.py  ->  写出一条演示日志并打印文件路径。
"""
import logging
import os
from logging.handlers import RotatingFileHandler

_LOG_FORMAT = '%(asctime)s %(levelname)-7s [%(name)s:%(lineno)d] %(message)s'
_CONSOLE_FORMAT = '%(levelname)-7s [%(name)s] %(message)s'
_server_dir = os.path.dirname(os.path.abspath(__file__))
LOGS_DIR = os.path.join(_server_dir, 'logs')
_ROOT_LOGGER = 'zf'
_MAX_BYTES = 5 * 1024 * 1024
_BACKUPS = 3
_configured = False


def setup(quiet_console=None, level=logging.INFO):
    """配置 zf 根日志器（幂等）。quiet_console 缺省读 config.QUIET_CONSOLE。"""
    global _configured
    if _configured:
        return
    root = logging.getLogger(_ROOT_LOGGER)
    root.setLevel(level)
    os.makedirs(LOGS_DIR, exist_ok=True)
    fh = RotatingFileHandler(os.path.join(LOGS_DIR, 'zf-server.log'),
                             maxBytes=_MAX_BYTES, backupCount=_BACKUPS, encoding='utf-8')
    fh.setFormatter(logging.Formatter(_LOG_FORMAT))
    root.addHandler(fh)
    if quiet_console is None:
        try:
            from config import QUIET_CONSOLE
            quiet_console = bool(QUIET_CONSOLE)
        except Exception:
            quiet_console = False
    if not quiet_console:
        ch = logging.StreamHandler()
        ch.setFormatter(logging.Formatter(_CONSOLE_FORMAT))
        root.addHandler(ch)
    _configured = True


def get_logger(name):
    """取带 zf 前缀的模块日志器；首次调用自动完成 setup。"""
    if not _configured:
        setup()
    return logging.getLogger('%s.%s' % (_ROOT_LOGGER, name))


if __name__ == '__main__':
    log = get_logger('util_log.selftest')
    log.info('util_log 自检：轮转文件日志链路 OK')
    log.warning('警告级别自检')
    log.info('%s %s', '日志文件:', os.path.join(LOGS_DIR, 'zf-server.log'))
