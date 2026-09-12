#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""send_email - 发送邮件"""

import os
import json
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'send_email'


def handle(body, ctx):
    """处理工具请求"""
    try:
        subject = body.get('subject', '(无主题)')
        mail_body = body.get('body', '')
        to = body.get('to', '')
        is_html = body.get('is_html', False)

        # 读取SMTP配置
        config_path = os.path.join(ctx.base_dir, 'private', 'email_config.json')
        if not os.path.exists(config_path):
            ctx.send_json({'ok': False, 'error': '未找到邮件配置文件 (private/email_config.json)'})
            return

        with open(config_path, 'r', encoding='utf-8') as f:
            smtp_cfg = json.load(f)

        # 安全：邮件总开关，email_config.json 中 "allow_email": true 才允许发送
        if not smtp_cfg.get('allow_email', False):
            ctx.send_json({'ok': False, 'error': '邮件功能未开启：请在 private/email_config.json 中设置 "allow_email": true'})
            return

        smtp_host = smtp_cfg.get('smtp_host', '')
        smtp_port = int(smtp_cfg.get('smtp_port', 465))
        smtp_user = smtp_cfg.get('smtp_user', '')
        smtp_pass = smtp_cfg.get('smtp_pass', '')
        from_addr = smtp_cfg.get('from_addr', smtp_user)
        default_to = smtp_cfg.get('default_to', '')

        if not smtp_host or not smtp_user:
            ctx.send_json({'ok': False, 'error': '邮件配置不完整：缺少 smtp_host 或 smtp_user'})
            return

        if not to:
            to = default_to
        if not to:
            ctx.send_json({'ok': False, 'error': '未指定收件人'})
            return

        # 构建邮件
        msg = MIMEMultipart()
        msg['Subject'] = subject
        msg['From'] = from_addr
        msg['To'] = to

        if is_html:
            msg.attach(MIMEText(mail_body, 'html', 'utf-8'))
        else:
            msg.attach(MIMEText(mail_body, 'plain', 'utf-8'))

        # 发送
        if smtp_port == 465:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30)
        else:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=30)
            server.starttls()

        server.login(smtp_user, smtp_pass)
        server.sendmail(from_addr, to.split(','), msg.as_string())
        server.quit()

        ctx.send_json({'ok': True, 'message': f'邮件已发送至 {to}'})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
