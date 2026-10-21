# -*- coding: utf-8 -*-
"""触发 zf3d.com 生产部署 webhook。
密钥从环境变量 ZF_DEPLOY_SECRET 读取，不再硬编码入库。
用法：先 set ZF_DEPLOY_SECRET=<新密钥> 再运行本脚本。
"""
import os
import sys
import json
import requests

PROX = {'http': None, 'https': None}

secret = os.environ.get('ZF_DEPLOY_SECRET', '').strip()
if not secret:
    sys.exit('错误：未设置环境变量 ZF_DEPLOY_SECRET，拒绝以空密钥请求。')

body = {
    "hook_name": "push_hooks",
    "ref": "refs/heads/main",
    "after": "716b9ad",
    "before": "b07658c",
    "event_name": "push",
    "password": secret,
}

# 方式一：表单直发（默认开启证书校验）
r = requests.post('https://www.zf3d.com/deploy_webhook.asp',
                  data=json.dumps(body).encode('utf-8'),
                  timeout=60, proxies=PROX)
print('direct:', r.status_code, r.text[:200])

if r.status_code != 202:
    # 方式二：X-Gitee-Event 头方式
    headers = {'X-Gitee-Event': 'Push Hook'}
    r = requests.post('https://www.zf3d.com/deploy_webhook.asp',
                      data=json.dumps(body).encode('utf-8'),
                      headers=headers, timeout=60, proxies=PROX)
    print('header way:', r.status_code, r.text[:200])
