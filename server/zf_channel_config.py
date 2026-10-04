# -*- coding: utf-8 -*-
"""
zf_channel_config.py - 朱峰模型 · 识图 / 图片生成 独立通道与费率配置

背景：
  朱峰模型（会员Token线路）是收费唯一渠道。识图（vision）与图片生成（imageGen）
  成本远高于普通文本对话，因此必须走独立的上游通道 + 独立费率计费。

  ⚠️ 费率数值当前为占位值，等站长给正式费率后直接改本文件的 RATE 表即可，
     其余代码只读本模块，不散落硬编码。

通道约定（后台需要走的不同通道）：
  - 识图   : 智谱 GLM（如 glm-4.5-flash / glm-5.3-flash，以站长最终确认为准）
  - 生图   : 火山方舟（Volcengine Ark，doubao-seedream 等）
  - 文本   : 朱峰模型主线路（现有逻辑不变）

费率单位：朱峰Token（会员余额）。换算系数 RMB_TO_TOKEN：1元人民币 = RMB_TO_TOKEN 个Token。
费率单位：人民币元（与网页会员余额同单位，1元=1元，站长 2026-09-17 最终确认）。
费率规则（站长 2026-09-17 最终确认，人民币直收）：
  - 识图：与文字对话同价（走文本Token计费，不在此单独收费，rate=0）
  - 生图：1 元/张（不分 lite/pro）
  - 视频：2 元/秒
"""

import json
import math
import os

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'zf_channel_rates.json')

# ================= 换算系数（已弃用） =================
# 2026-09-17 起费率直接用人民币元（与网页会员余额同单位，1元=1元），不再做 Token 换算。
# get_rmb_to_token 保留返回 1.0 以兼容旧引用。
DEFAULT_RMB_TO_TOKEN = 1.0

def get_rmb_to_token():
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            v = float(json.load(f).get('rmb_to_token', 0))
            return v if v > 0 else DEFAULT_RMB_TO_TOKEN
    except Exception:
        return DEFAULT_RMB_TO_TOKEN

# ================= 默认通道与费率（占位，待站长填写） =================
DEFAULT_CHANNELS = {
    # ---- 识图（vision）----
    'vision': {
        'enabled': True,
        'provider': 'zhipu',                # 通道：智谱
        'baseUrl': 'https://open.bigmodel.cn/api/paas/v4',  # OpenAI 兼容
        'modelId': 'glm-5.3-flash',        # 站长已确认：原生多模态，图片走 image_url（URL/Base64 均可）
        'apiKey': '',                       # TODO: 站长填智谱 key
        # 费率（朱峰Token）：识图与文字同价，不单独计费（rate=0）
        'rate_per_image': 0,               # 识图每张与文本Token同价，不另扣
        'rate_per_call': 0,
        'max_images_per_call': 4,          # 单次最多识图张数（防滥用）
    },
    # ---- 图片生成（imageGen）----
    'imagegen': {
        'enabled': True,
        'provider': 'volcengine',           # 通道：火山方舟
        'baseUrl': 'https://ark.cn-beijing.volces.com/api/plan/v3',  # Agent Plan 专属地址（含 /plan，勿用通用地址）
        'modelId': 'doubao-seedream-5.0-lite',  # Agent Plan 生图模型；Pro 为 doubao-seedream-5-0-pro
        # 成本参考：1 张成功生成图 = 99 AFP；输入参考图第1张免费，第2张起 10 AFP
        'apiKey': '',                       # TODO: 站长填 Agent Plan 专属 API Key（普通方舟 key 不可用）
        # 费率（人民币元，与会员余额同单位）：1 元/张（站长 2026-09-17 确认）
        'rate_per_image': 1,
        'rate_per_call': 0,
        'max_images_per_call': 4,          # 单次最多生成张数
        'sizes': ['1024x1024', '864x1152', '1152x864', '1280x720', '720x1280'],
    },
    # ---- 文本对话（走朱峰模型主线路，无独立费率，正常按Token计） ----
    'chat': {
        'enabled': True,
        'provider': 'zhufeng',
        'note': '主线路，费用走会员Token按token计，不在此配置',
    },
    # ---- 视频生成（videoGen）----
    'video': {
        'enabled': True,
        'provider': 'volcengine',           # 通道：火山方舟
        'baseUrl': 'https://ark.cn-beijing.volces.com/api/plan/v3',
        'modelId': 'doubao-seedance-1-0-lite-t2v',  # lite 720p；pro 为 doubao-seedance-1-0-pro
        # 费率（人民币元，与会员余额同单位）：2 元/秒（站长 2026-09-17 确认）
        'rate_per_second': 2,
        'rate_per_call': 0,
        'max_seconds_per_call': 10,         # 单次最长秒数（防滥用）
    },
}


def _load_json(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def load_channels(include_secret=False):
    """读取通道配置（json 覆盖 > 默认）。include_secret=False 时掩码 apiKey。"""
    cfg = json.loads(json.dumps(DEFAULT_CHANNELS))  # deep copy
    override = _load_json(CONFIG_FILE, {})
    for k, v in (override or {}).items():
        if k in cfg and isinstance(v, dict):
            cfg[k].update(v)
        else:
            cfg[k] = v
    if not include_secret:
        for name, ch in cfg.items():
            if isinstance(ch, dict) and ch.get('apiKey'):
                ch['apiKeyMasked'] = '****' + str(ch['apiKey'])[-4:]
                ch.pop('apiKey', None)
    return cfg


def get_channel(name, include_secret=False):
    ch = load_channels(include_secret=True).get(name)
    if not ch:
        return None
    if not include_secret and ch.get('apiKey'):
        ch = dict(ch)
        ch['apiKeyMasked'] = '****' + str(ch['apiKey'])[-4:]
        ch.pop('apiKey', None)
    return ch


def save_channels(new_cfg):
    """保存可公开编辑的字段（费率、开关、modelId 等）；apiKey 仅在非空时覆盖。"""
    cur = _load_json(CONFIG_FILE, {})
    for name, ch in (new_cfg or {}).items():
        if name not in DEFAULT_CHANNELS:
            continue
        slot = cur.setdefault(name, {})
        for k in ('enabled', 'rate_per_image', 'rate_per_call',
                  'max_images_per_call', 'modelId', 'baseUrl', 'provider'):
            if k in ch:
                slot[k] = ch[k]
        if ch.get('apiKey'):
            slot['apiKey'] = ch['apiKey']
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cur, f, ensure_ascii=False, indent=2)
    return True


def calc_cost(channel_name, n_images=1, n_seconds=0):
    """计算一次调用应扣的人民币元（与会员余额同单位，1元=1元）。费率未配置(0)时返回 0（暂不计费）。
    - imagegen: 费率=元/张，按张数
    - video:    费率=元/秒，按秒数
    返回 (cost, n)，n 为参与计费的数量（张数或秒数）。
    """
    ch = get_channel(channel_name, include_secret=True) or {}
    if channel_name == 'video':
        n = max(0, min(int(n_seconds or 0), int(ch.get('max_seconds_per_call', 10))))
        cost = float(ch.get('rate_per_call', 0) or 0) + float(ch.get('rate_per_second', 0) or 0) * n
    else:
        n = max(1, min(int(n_images or 1), int(ch.get('max_images_per_call', 4))))
        cost = float(ch.get('rate_per_call', 0) or 0) + float(ch.get('rate_per_image', 0) or 0) * n
    return cost, n


def rates_ready(channel_name):
    """费率是否已配置（上线检查用）。"""
    ch = get_channel(channel_name, include_secret=True) or {}
    return (float(ch.get('rate_per_image', 0) or 0) > 0 or float(ch.get('rate_per_call', 0) or 0) > 0
            or float(ch.get('rate_per_second', 0) or 0) > 0)
