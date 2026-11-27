# -*- coding: utf-8 -*-
"""schedule.employee：员工调度定时线程（T5，策划案v4）。

桥接 server/employee_scheduler.start()（过渡桥：实现体摘壳归 T5/T8 完成态）。
start() 自带 _started 幂等锁——与 db.init_db 的启动调用天然互斥，
无论谁先执行都只有一个线程，无需双轨守卫。
"""


def setup(ctx):
    import employee_scheduler
    employee_scheduler.start()
    ctx.log.info("employee scheduler thread started via plugin (idempotent start)")


def teardown(ctx):
    # 线程为 daemon 且 start 幂等锁在模块级；摘壳收口（T5/T8）时改为可中断停止。
    ctx.log.info("employee scheduler teardown (daemon thread left running; idempotent)")
