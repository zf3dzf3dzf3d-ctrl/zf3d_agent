/* 伺服真源=项目根 public/（见 server/config.py PUBLIC_DIR）；改动必须改根副本并同步 server/public/js/ 副本 */
/* =====================================================================
 * crew-four-masters.js — 🎮 批次1 四师协议化注册（游戏师/漫画师/聊天师/股票师）
 * =====================================================================
 * v1.0 2026-11-07｜策划案 v1.2 批次1 试点：走 crew-protocol 协议化注入，
 * 引擎零改动（复用 _objectorExpand cfg 通道 + injectPanel 面板注入）。
 * 职责边界（与既有角色裁界）：
 *   游戏师 = 游戏玩法/关卡/数值策划（≠ 策划师的全案策划）
 *   漫画师 = 分镜/画格叙事策划（不产图，只出分镜脚本）
 *   聊天师 = 日常陪伴聊天/情绪价值（≠ 普通对话的多路对比、≠ 策划师的任务策划）
 *   股票师 = 个股/行情信息整理与风险提示（非投资建议，无实时 API 时提醒用户自填数据）
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ZFFourMasters) return; // 幂等守卫
  var P = window.ZFFourMasters = { version: '1.0' };

  var TEAM_ID = 'team_four_masters_2026';
  var TEAM_NAME = '批次1四师';

  var ROLES_DEF = [
    {
      name: '游戏师', face: '🎮', count: 0,
      brief: '围绕当前需求输出游戏设计方案：核心玩法循环、关卡/系统结构、数值框架、可玩性风险；分「设计/风险/下一步」三段给结论。',
      duty: '【游戏师任务】你是游戏师（玩法策划）：专门做游戏核心玩法、关卡结构、系统与数值框架设计。输出必须包含：①核心玩法循环一句话；②系统/关卡拆解（可落地）；③数值框架初稿；④可玩性与工作量风险标注【高/中/低】。不做美术/代码实现，不改他人方案，只出设计方案。',
      tag: '【游戏师结论】'
    },
    {
      name: '漫画师', face: '📚', count: 0,
      brief: '围绕当前需求输出漫画分镜脚本：页/格切分、每格画面描述、台词与情绪节拍；只出分镜脚本不产图。',
      duty: '【漫画师任务】你是漫画师（分镜叙事）：专门把故事/需求切成分镜脚本。输出必须包含：①页-格结构表（每格：画面描述/构图要点/台词/情绪节拍）；②叙事节奏说明；③绘制注意事项。不产出图片，不写代码，只出分镜脚本文本。',
      tag: '【漫画师结论】'
    },
    {
      name: '聊天师', face: '🗨️', count: 0,
      brief: '以轻松自然的陪伴口吻回应用户：接住情绪、给出共鸣与温和建议；不拆任务、不做策划、不多路对比。',
      duty: '【聊天师任务】你是聊天师（陪伴对话）：专门提供日常聊天与情绪价值。用轻松自然的口吻回应用户最后一句话，先接住情绪再给温和建议。明确不做：任务拆解（策划师的事）、多路答案对比（普通对话的事）、专业方案（各师的事）。',
      tag: '【聊天师回应】'
    },
    {
      name: '股票师', face: '📈', count: 0,
      brief: '整理用户提供的个股/行情信息：基本面/技术面/资金面要点归纳，并列出风险提示；无实时数据时明确说明并请用户提供数据；不给买卖建议。',
      duty: '【股票师任务】你是股票师（行情信息整理）：只做用户所给信息的归纳分析——基本面/技术面/资金面要点、历史规律参考。硬性纪律：①你没有实时行情数据，缺数据时明确说明并请用户提供；②每条结论附风险提示；③绝对禁止给出买卖建议或收益承诺，结尾必须写「以上为信息整理，不构成投资建议」。',
      tag: '【股票师整理】'
    }
  ];

  /* 幂等注册：protocol 存储里没有该团队才创建（用户手动删除后不复活） */
  P.ensure = function () {
    try {
      if (!window.ZFCrewProtocol || !ZFCrewProtocol.exec) return false;
      var list = ZFCrewProtocol.list ? ZFCrewProtocol.list() : [];
      for (var i = 0; i < list.length; i++) { if (list[i].id === TEAM_ID) { return true; } }
      var r = ZFCrewProtocol.exec('create', {
        id: TEAM_ID, name: TEAM_NAME, author: '批次1试点', desc: '游戏/漫画/聊天/股票四师（协议化注册，批次1试点）', silent: true,
        roles: ROLES_DEF.map(function (r) {
          return { name: r.name, face: r.face, count: r.count, brief: r.brief, duty: r.duty, tag: r.tag };
        })
      });
      return !!(r && r.ok);
    } catch (e) { try { console.warn('[four-masters] 注册失败:', e); } catch (e2) {} return false; }
  };

  /* 协议加载器/面板就绪后注入（双触发 + 轮询兜底，与 crew-protocol 同套路） */
  function boot() {
    if (!P.ensure()) {
      var tries = 0;
      var t = setInterval(function () {
        if (P.ensure() || ++tries > 20) clearInterval(t);
      }, 1000);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
