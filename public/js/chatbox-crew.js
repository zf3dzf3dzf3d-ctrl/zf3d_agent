/* 协作施工队（Crew 模式）独立入口 v2 —— 与赛马（chatbox-race.js）完全两条线，零引用零串台。
 * v2 新增：黑板进度面板（10s 轮询 board，片状态/认领窗/done 摘要/超时回收与 close 提示）。
 * 功能：主对话选择「派协作队」→ 输入 crew_id + 分片清单 → POST /api/crew/create 建黑板
 *      → 打开协作窗（素材包首条消息注入认领/读总线协议）→ 面板实时看黑板。
 */
(function () {
  'use strict';
  if (window.ZFCrew) return;

  function api(path, body) {
    return fetch('/api/crew/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(r => r.json());
  }

  function buildPack(crewId, role) {
    return '（协作队素材包）\n'
      + '【协作施工队协议】crew_id=' + crewId + ' 窗口角色=' + (role || 'worker') + '\n'
      + '【crew API 基地址】' + location.origin + ' ——所有 /api/crew/* 请求必须发到「' + location.origin + '/api/crew/...」。\n'
      + '⚠️ 严禁猜测或扫描端口；连不上时直接报告等待人工，不得换端口重试。\n'
      + '你是协作施工队窗口，与多支协作队共处同一共享现场，分片共干一活。铁律：\n'
      + '1. 开工先 POST /api/crew/board 读黑板，只认领 status=pending 的分片（POST /api/crew/claim）。\n'
      + '2. 认领即锁文件：只允许改认领片 files 清单内的文件，他人认领的文件一律不碰。\n'
      + '3. 抢片失败（CREW_CLAIMED）换其他 pending 片，不得强行改。\n'
      + '4. 每片完工必须：① 对认领片 files 清单内文件逐一 git add（禁止整仓 add）并独立 commit，'
      + '提交信息带署名 [crew:' + crewId + ':<片id>]；② POST /api/crew/done 回写摘要；③ POST /api/crew/bus-post 广播。\n'
      + '5. 每轮开工前 POST /api/crew/bus-tail 读总线尾巴，@本窗 的消息必须回应。\n'
      + '6. 全部分片 done 后通知主对话走审核员收口，不自行合并分支。\n'
      + '7.【自动拆片】若黑板唯一分片 id=auto（占位兜底片），本窗为首个施工窗，必须：\n'
      + '   ① 拆片硬规则：若【本次任务描述】中带有【执行规划】章节（含「### 分片N」任务书），必须严格按该章节的每片任务书生成分片（id 用分片N 或顺序编号，title/files/brief/验收标准照抄规划），片数和范围禁止自行改动；没有【执行规划】章节时才自行拆 2~4 个互不重叠的分片（每片含 id/title/files/brief，files 不许交叉）；\n'
      + '   ② POST /api/crew/slices-upsert {crew_id, slices:[...], by:本窗名} 整体替换分片清单（仅全片 pending 时允许）；\n'
      + '   ③ 替换成功后再按铁律 1 正常认领施工。若 slices-upsert 失败（已有他窗抢认领），改读新黑板按新分片走。\n'
      + '8.【计划书·必读铁律】开工前先 POST /api/crew/board 读黑板——素材包任务描述中只要出现 .md 路径字样即视为计划书（不一定是长期目标，可能是任意任务说明/执行规划/分片任务书 md），第一优先必读，必须先用 read_file 读取其全文；黑板响应带 goal_md 字段时为辅助计划书，同样必须读取。按该 md 的目标与改动清单施工，如现场与 md 冲突，只上报、不得自行偏离。两者都没有时：不得开工、不得猜任务，必须向主对话报告「缺少计划书 md」，等待人工指示后再施工。\n';
  }

  function buildReviewerPack(crewId) {
    return '（协作队素材包）\n'
      + '【协作收口协议·审核员】crew_id=' + crewId + ' 窗口角色=reviewer\n'
      + '【crew API 基地址】' + location.origin + ' ——所有 /api/crew/* 请求必须发到「' + location.origin + '/api/crew/...」，严禁猜测/扫描端口。\n'
      + '你是本协作现场的审核员。职责：\n'
      + '1. POST /api/crew/board 读黑板，核对全部分片 status=done 且 done_summary 非空。\n'
      + '2. 逐片验收代码（重点核对每片 commit 是否只含认领片 files、署名 [crew:' + crewId + ':<片id>] 是否齐全）。\n'
      + '3. 验收通过后合并 site/crew/' + crewId + ' 分支到主分支，再 POST /api/crew/close 关闭黑板。\n'
      + '4. 发现问题把该片打回：POST /api/crew/bus-post @认领窗说明原因（该窗会按总线尾巴纪律回应）。\n'
      + '5.【主对话纪律·收口汇报必带】全部收口完成后，向主对话汇报时必须在汇报开头写明以下要求：\n'
      + '   ① 主对话只做统筹协调（调度策划/施工/审核、跟进进度），严禁亲自修改任何代码文件；\n'
      + '   ② 主对话必须把本次协作的最终结果整理成一份 md 文件写出（用 write_file 落盘，如 private/记忆/协作-<主题>.md，含任务目标、各分片完成情况、合并结果、遗留事项），不得只在聊天里口头总结；\n'
      + '   ③ 如有后续工作，主对话负责拆解并再次派出对应角色窗口，不亲自施工。\n';
  }

  // ---------- v4：结构化开工弹窗（零术语、零 JSON） ----------
  function genCrewId() {
    const d = new Date();
    const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    let seq = 1;
    try {
      const rec = JSON.parse(localStorage.getItem('zf_crew_id_seq') || '{}');
      if (rec.day === ymd) seq = (rec.seq || 0) + 1;
      localStorage.setItem('zf_crew_id_seq', JSON.stringify({ day: ymd, seq: seq }));
    } catch (e) { /* 忽略 */ }
    return 'crew-' + ymd + '-' + String(seq).padStart(2, '0');
  }

  // v5：从源对话提取最近消息作为任务上下文（协作开工免输入）
  let dispatchSrcChat = null;
  /* 【v29 计划书锁定】从任务文本提取 .md 路径（含 private/记忆/、docs/ 等任意位置），
     随 /api/crew/create 存入黑板，board 读取时优先返回它，防止施工窗被兜底指到 private/计划书 旧案。 */
  function extractMdPath(text) {
    /* 【v33 定稿闭环】优先识别策划师结论行末尾的显式标记「【策划案路径：xxx.md】」，消灭误抓无关 md；无标记时退回普通 md 正则 */
    const tag = String(text || '').match(/【策划案路径[:：]\s*([^\s'\"<>【】，,；;（）()]+\.md(?:arkdown)?)\s*】/i);
    if (tag) return tag[1];
    const m = String(text || '').match(/[\w\-\/\\.\u4e00-\u9fff]+\.(?:md|markdown)/i);
    return m ? m[0] : '';
  }

  /* 【v27 规划直通】优先抽取策划案回注中的【执行规划】章节（含 md 计划书路径），保证施工队按策划师预写的分片任务书施工 */
  function extractPlanSection(chat) {
    try {
      const ms = (chat && chat.messages) || [];
      /* 【v33 定稿闭环】优先识别策划师结论中的显式标记「【策划案路径：xxx.md】」：找到即直接以该 md 为施工任务书（主对话定稿后才允许开工，故存在标记=已定稿或待定稿策划案） */
      for (let i = ms.length - 1; i >= 0; i--) {
        const cAll = String((ms[i] && ms[i].content) || '');
        const tag = cAll.match(/【策划案路径[:：]\s*([^\s'\"<>【】，,；;（）()]+\.md(?:arkdown)?)\s*】/i);
        if (tag) {
          const p = tag[1];
          /* 同消息若含【执行规划】章节则一并带上（含分片任务书），否则仅返回计划书路径 */
          const idx0 = cAll.indexOf('【执行规划】');
          if (idx0 >= 0) {
            let end0 = cAll.indexOf('【', idx0 + 6);
            if (end0 < 0) end0 = cAll.length;
            let seg0 = cAll.slice(idx0, Math.min(end0, idx0 + 16000));
            return '【计划书md】' + p + '\n' + seg0;
          }
          return '【计划书md】' + p + '\n（本任务唯一真源为该策划案 md，所有 worker 必须先完整阅读该文件，按其中【执行规划】/分片任务书施工，严禁凭空发挥。）';
        }
      }
      for (let i = ms.length - 1; i >= 0; i--) {
        const c = String((ms[i] && ms[i].content) || '');
        if (c.indexOf('【执行规划】') < 0) continue;
        const idx = c.indexOf('【执行规划】');
        /* 【v28 审核采纳】按章节边界截取（到下一个【 或消息末尾），上限 16000，避免长规划尾部分片任务书被截断漏片 */
        let end = c.indexOf('【', idx + 6);
        if (end < 0) end = c.length;
        let seg = c.slice(idx, Math.min(end, idx + 16000));
        const md = (seg.match(/[^\s'"<>，,；;（）()]+\.md\b/i) || (c.match(/[^\s'"<>，,；;（）()]+\.md\b/i) || []))[0];
        if (md) seg = '【计划书md】' + md + '\n' + seg;
        return seg;
      }
    } catch (e) {}
    return null;
  }
  function extractTask(chat) {
    try {
      const plan = extractPlanSection(chat);
      if (plan) return plan;
      const ms = (chat && chat.messages) || [];
      const picks = ms.filter(m => m.role === 'user').slice(-3).map(m => String(m.content || '').slice(0, 1500));
      const ai = ms.filter(m => m.role === 'assistant').slice(-3).map(m => String(m.content || '').slice(0, 1500));
      return picks.concat(ai).join('\n').trim();
    } catch (e) { return ''; }
  }

  function openDispatchDialog(srcChat) {
    dispatchSrcChat = srcChat || null;
    // 已有弹窗不重复开
    if (document.getElementById('zf-crew-dispatch-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'zf-crew-dispatch-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:10000;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'width:640px;max-width:92vw;max-height:86vh;overflow:auto;background:#fff;border-radius:10px;padding:16px 18px;box-shadow:0 8px 32px rgba(0,0,0,.25);font-size:13px;color:#333;';
    /* v6 赛马式极简弹窗：只选协作窗数，任务自动取源对话上下文，零输入；
       选窗数后先展示任务摘要预览，确认后才真正开工（防 extractTask 抓错） */
    const taskCtx = extractTask(dispatchSrcChat) || ('【当前任务】请阅读项目现状后自行确定待完成工作并施工。');
    const taskPrev = taskCtx.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 500);
    box.innerHTML =
      '<div style="font-weight:bold;font-size:15px;margin-bottom:4px;">🐝 协作开工</div>'
      + '<div style="color:#888;margin-bottom:8px;">确认后各施工窗自动开工、自行协商，无需你操作。</div>'
      + '<div id="zf-crew-step1">'
      + '<div style="display:flex;gap:8px;margin-bottom:14px;">'
      + [2, 3, 4, 5].map(n => '<button class="zf-crew-nbtn" data-n="' + n + '" style="flex:1;padding:14px 0;font-size:16px;border-radius:8px;border:1px solid #ccc;background:#fafafa;cursor:pointer;"><b>' + n + '</b> 窗</button>').join('')
      + '</div></div>'
      + '<div id="zf-crew-step2" style="display:none;">'
      + '<div style="margin-bottom:6px;color:#888;font-size:11px;">任务上下文（会发给所有施工窗，可编辑修改——必须包含一份 md 文件路径（施工队按 md 施工，不要求是长期目标，任意任务说明/计划 md 均可，如 private/记忆/xxx.md 或 docs/计划书.md））：</div>'
      + '<textarea id="zf-crew-task-edit" style="width:100%;height:130px;box-sizing:border-box;border:1px solid #e0e0e0;background:#fff;border-radius:6px;padding:8px;font-size:12px;white-space:pre-wrap;color:#333;margin-bottom:10px;">' + taskCtx.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</textarea>'
      + '<div id="zf-crew-md-hint" style="display:none;color:#d93025;background:#fdecea;border:1px solid #f5c6cb;border-radius:6px;padding:8px 10px;font-size:12px;margin-bottom:10px;white-space:pre-wrap;"></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      + '  <button id="zf-crew-back" type="button" style="padding:6px 16px;">返回</button>'
      + '  <button id="zf-crew-confirm" type="button" style="padding:6px 20px;background:#e6782a;color:#fff;border:none;border-radius:6px;cursor:pointer;">确认开工 <b id="zf-crew-confirm-n"></b> 窗</button>'
      + '</div></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">'
      + '  <button id="zf-crew-cancel" type="button" style="padding:6px 16px;">取消</button>'
      + '</div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const $ = id => document.getElementById(id);
    let chosenN = 0;
    /* 【v27 规划对齐】策划案【执行规划】里写了几片，默认高亮几个窗 */
    let planN = 0;
    try {
      const _m = (taskCtx.match(/###\s*分片\s*(\d+)/g) || []);
      /* 【v28 审核采纳】分片号不连续时以「数量」为准（如分片2、分片5 → 2 片），避免最大编号误判窗数 */
      const _nums = _m.map(s => parseInt(s.replace(/\D/g, ''), 10) || 0).filter(Boolean);
      planN = (_nums.length > 0 && Math.max(..._nums) !== _nums.length) ? _nums.length : (Math.max(0, ..._nums) || _m.length || 0);
    } catch (e) {}
    if (planN >= 2) {
      const planBtn = box.querySelector('.zf-crew-nbtn[data-n="' + planN + '"]');
      if (planBtn) {
        planBtn.style.background = '#e6782a'; planBtn.style.color = '#fff'; planBtn.style.borderColor = '#e6782a';
        planBtn.innerHTML = planBtn.innerHTML + ' <span style="font-size:11px;">按规划</span>';
        /* 【v28 审核采纳】真正自动选中：默认按规划片数进入第 2 步，用户仍可点「返回」改窗数 */
        if (chosenN === 0) {
          chosenN = planN;
          $('zf-crew-step1').style.display = 'none';
          $('zf-crew-step2').style.display = 'block';
          $('zf-crew-confirm-n').textContent = chosenN;
        }
      } else {
        const tip = document.createElement('div');
        tip.style.cssText = 'color:#b26a00;background:#fff7e6;border:1px solid #e6c34a;border-radius:6px;padding:6px 10px;font-size:12px;margin-bottom:8px;';
        tip.textContent = '⚠️ 策划案【执行规划】为 ' + planN + ' 片，与可选窗数不一致——建议按规划调整或开工后由 worker-1 照规划片数写黑板。';
        const step1 = box.querySelector('#zf-crew-step1');
        step1.insertBefore(tip, step1.lastChild);
      }
    }
    box.querySelectorAll('.zf-crew-nbtn').forEach(b => {
      b.onclick = () => {
        chosenN = parseInt(b.getAttribute('data-n'), 10);
        $('zf-crew-step1').style.display = 'none';
        $('zf-crew-step2').style.display = 'block';
        $('zf-crew-confirm-n').textContent = chosenN;
      };
    });
    $('zf-crew-back').onclick = () => {
      $('zf-crew-step2').style.display = 'none';
      $('zf-crew-step1').style.display = 'block';
    };
    $('zf-crew-confirm').onclick = () => {
      const btn = $('zf-crew-confirm');
      const hint = $('zf-crew-md-hint');
      const showHint = msg => { if (hint) { hint.textContent = msg; hint.style.display = 'block'; } else { alert(msg); } };
      /* 用户可编辑任务上下文：以输入框实际内容为准 */
      const edited = ($('zf-crew-task-edit') || {}).value;
      const finalTask = (typeof edited === 'string' && edited.trim()) ? edited.trim() : taskCtx;
      /* 【铁律·公共函数】施工队必须读到 md（任意任务说明/计划 md，不要求是长期目标）才允许开工 */
      const mdPath = extractMdPath(finalTask);
      if (!mdPath) {
        showHint('🐝 还差一步：任务上下文里没看到 md 文件路径。把 md 路径写进去（如 private/记忆/xxx.md）就能开工啦～');
        return;
      }
      btn.disabled = true; btn.textContent = '校验 md 中…';
      validateMd(mdPath)
        .then(() => {
          btn.textContent = '建现场中…';
          return startCrew(genCrewId(), chosenN, finalTask, dispatchSrcChat).then(() => overlay.remove());
        })
        .catch(e => {
          showHint('🐝 md「' + mdPath + '」暂时读不到（' + (e.message || e) + '）。确认下路径写法，改好就能开工～');
          btn.disabled = false; btn.innerHTML = '确认开工 <b id="zf-crew-confirm-n">' + chosenN + '</b> 窗';
        });
    };
    $('zf-crew-cancel').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  }

  /* 【md 铁律·公共函数】两个开工入口（弹窗确认 / 收敛派单）统一走：
     提取任务上下文中的 .md 路径 → /api/fs/text 验证真实存在可读 → 通过才允许 startCrew */
  /* 【v33.2 审核采纳·合并去重】extractMdPath 全文件仅保留唯一实现（文件前部，含【策划案路径：】显式标记
     优先 + .markdown 支持 + 统一返回 ''）。此前此处曾有一份重复同名声明靠函数提升「碰巧行为兼容」，
     已删除，防止将来只改其中一份静默失效。 */
  async function validateMd(mdPath) {
    const r = await fetch('/api/fs/text?path=' + encodeURIComponent(mdPath), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const okRead = j && (j.ok !== false) && j.text != null && String(j.text).trim().length > 0;
    if (!okRead) throw new Error('md 内容为空或不可读');
  }

  async function startCrew(crewId, n, task, srcChat) {
    const mdPath = extractMdPath(task);
    /* 【v33 硬拦截配套】服务端已强制 task_md 必传：前端提前拦截，给用户明确指引而非报错 */
    if (!mdPath) throw new Error('未找到策划案 md（【策划案路径：…】标记）：请先让策划师落盘策划案并由你定稿，再派协作队开工。');
    const r = await api('create', Object.assign(
      { crew_id: crewId, slices: [], task: task, branch: 'site/crew/' + crewId },
      { task_md: mdPath }
    ));
    if (!r.ok) throw new Error(r.error || '建现场失败');
    rememberCrew(crewId);
    const srcId = (srcChat && (srcChat.id || (srcChat.el && srcChat.el.id))) || null;
    // 【v11 黑板先写后看】首窗立即开工（带任务上下文，负责自动拆片写黑板）；
    // 其余窗不再同时开——轮询黑板，等首窗拆好片（出现 id≠auto 的分片）后再开窗，
    // 素材包改为「看板找活」模式：开工直接读黑板认领 pending 片，无需人工派活。
    // 兜底：最长等 120 秒（首窗拆片可能较慢），超时也开窗（素材包保留自动拆片协议，若黑板仍为 auto 占位则该窗接手拆片）。
    const chat0 = openWorkerWindow(crewId, 'worker', task, 0);
    if (chat0) _bindCrewWindow(chat0, crewId, 'worker-1', srcId);
    if (n <= 1) return;
    const t0 = Date.now();
    /* v26：等待首窗拆片期间持续提示，避免用户以为其他窗卡死 */
    let _waitToastTimer = setInterval(() => {
      const el = document.getElementById('zf-crew-wait-hint') || (() => {
        const d = document.createElement('div');
        d.id = 'zf-crew-wait-hint';
        d.style.cssText = 'position:fixed;right:12px;bottom:150px;z-index:9997;padding:8px 14px;background:#fffbe6;border:1px solid #e6c34a;border-radius:8px;font-size:12px;color:#8a6d00;box-shadow:0 2px 10px rgba(0,0,0,.12);';
        d.textContent = '🐝 worker-1 正在拆分工作片并写黑板，拆好后其余窗自动开工（最长等 120 秒）…';
        document.body.appendChild(d);
        return d;
      })();
      const sec = Math.round((Date.now() - t0) / 1000);
      el.textContent = '🐝 worker-1 正在拆分工作片并写黑板（已等 ' + sec + 's），拆好后其余 ' + (n - 1) + ' 窗自动开工…';
    }, 1000);
    (function _waitBoard() {
      api('board', { crew_id: crewId }).then(res => {
        const slices = (res && res.ok && res.board && res.board.slices) || [];
        const hasReal = slices.some(s => s.id !== 'auto');
        const elapsed = Date.now() - t0;
        if (hasReal || elapsed > 120000) {
          clearInterval(_waitToastTimer);
          const hint = document.getElementById('zf-crew-wait-hint');
          if (hint) hint.remove();
          for (let i = 1; i < n; i++) {
            const chat = openWorkerWindow(crewId, 'worker', '', i);
            if (chat) _bindCrewWindow(chat, crewId, 'worker-' + (i + 1), srcId);
          }
          return;
        }
        setTimeout(_waitBoard, 4000);
      }).catch(() => {
        if (Date.now() - t0 > 120000) {
          clearInterval(_waitToastTimer);
          const hint = document.getElementById('zf-crew-wait-hint');
          if (hint) hint.remove();
          for (let i = 1; i < n; i++) {
            const chat = openWorkerWindow(crewId, 'worker', '', i);
            if (chat) _bindCrewWindow(chat, crewId, 'worker-' + (i + 1), srcId);
          }
          return;
        }
        setTimeout(_waitBoard, 4000);
      });
    })();
    // v26：黑板面板已恢复入口（右下角「📋 施工黑板」按钮），无需自动弹出
  }

  /* 【修复 v10】协作窗统一收尾：① 绑定「施工队」角色（复用赛马线 App.openRoleChat 同口径，
     无角色时降级不阻塞）；② 与源对话建 ZFRaceArrow 橙色连线（⤴回注 / 🧹收队 / 💬指令）。
     注：ZFRaceArrow 只依赖 DOM id + data-race-worktree 属性，协作窗复用安全（独立 crew_id，
     不与赛马 _site_ 目录串台）。 */
  function _bindCrewWindow(chat, crewId, team, srcChatId) {
    if (!chat) return;
    const boxEl = chat.el ? chat.el : chat;
    try {
      boxEl.setAttribute('data-race-worktree', 'crew://' + crewId);
      boxEl.setAttribute('title', '协作现场: ' + crewId);
      boxEl._raceTeam = team;
      if (srcChatId) boxEl._raceSrcId = srcChatId;
    } catch (e) {}
    // ① 绑定「施工队」角色（与赛马同口径：/api/roles 找 name 含「施工队」的角色，api select 绑定）
    (function _bindRole() {
      try {
        fetch('/api/roles').then(r => r.json()).then(res => {
          const role = ((res && res.roles) || []).filter(x => (x.name || '').indexOf('施工队') !== -1)[0] || null;
          if (!role) return;
          const boxId = boxEl.id || (chat && chat.id) || '';
          if (!boxId) return;
          fetch('/api/roles', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'select', box: boxId, role_id: role.id })
          }).then(r2 => r2.json()).then(() => {
            try {
              if (window.App && App._refreshRoleBadge) App._refreshRoleBadge(boxEl);
              const titleEl = boxEl.querySelector('.title');
              if (titleEl) titleEl.textContent = (role.avatar ? role.avatar + ' ' : '') + (role.name || '施工队') + ' · 协作';
            } catch (e) {}
          }).catch(() => {});
        }).catch(() => {});
      } catch (e) {}
    })();
    // ② 源对话 ↔ 协作窗 橙色箭头（回注/收队/指令）
    (function _arrow(tries) {
      tries = tries || 0;
      const srcEl = srcChatId ? document.getElementById(srcChatId) : null;
      if (srcEl && window.ZFRaceArrow && window.ZFRaceArrow.create) {
        try { window.ZFRaceArrow.create(srcEl, boxEl, team); } catch (e) {}
        return;
      }
      if (tries < 20) setTimeout(() => _arrow(tries + 1), 300);
    })(0);
  }

  /* 轻量浮动提示（替代生硬的 alert）：右上角浮层，3.5 秒自动消失 */
  function crewToast(msg) {
    try {
      let box = document.getElementById('zf-crew-toast');
      if (!box) {
        box = document.createElement('div');
        box.id = 'zf-crew-toast';
        box.style.cssText = 'position:fixed;top:18px;right:18px;z-index:99999;max-width:360px;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(box);
      }
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'background:rgba(30,30,32,.92);color:#fff;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.6;box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:0;transform:translateY(-6px);transition:all .25s;';
      box.appendChild(t);
      requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
      setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(-6px)'; setTimeout(() => t.remove(), 300); }, 3500);
    } catch (e) { console.log('[ZFCrew]', msg); }
  }

  /* 【零输入开工 v3】传入 n（窗口数）时跳过弹窗直接开工：任务上下文自动注入（首个窗带任务触发自动拆片） */
  async function dispatchCrew(srcChat, n) {
    if (typeof n === 'number' && n >= 1) {
      const crewId = genCrewId();
      /* 【P0 封堵旁路】收敛派单与弹窗入口同走 md 铁律：无 md 或 md 不可读一律拒绝开工 */
      const task = extractTask(srcChat) || '';
      const mdPath = extractMdPath(task);
      if (!mdPath) {
        crewToast('🐝 还差一步：暂时没找到 md 文件路径。把任务说明写成 md 并在对话里写明路径（如 private/记忆/xxx.md），再点开工就可以啦～');
        return;
      }
      try {
        await validateMd(mdPath);
        await startCrew(crewId, n, task, srcChat);
      } catch (err) { crewToast('🐝 md「' + mdPath + '」暂时读不到（' + (err.message || err) + '）。确认一下文件路径是否写对了，改好后随时可以再开工～'); }
      return;
    }
    return openDispatchDialog(srcChat);
  }

  /* 【v8 修复】window.createChatBox / window.sendToChatbox 在本项目根本不存在（真正的建窗链路是
     App.createChatBox(x, y, modelId)），旧写法永远命中静默降级 → 点了开工只建黑板不出窗。
     现改用 App.createChatBox + 输入框注入派单消息（与 chatbox-race.js 同口径），窗口真正弹出来干活。 */
  function openWorkerWindow(crewId, role, task, idx) {
    if (!window.App || typeof App.createChatBox !== 'function') {
      console.warn('[ZFCrew] blackboard ready, front-end App.createChatBox unavailable:', crewId);
      return null;
    }
    const i = idx || 0;
    // 阶梯错位落点，避免 N 个窗完全重叠
    const x = 90 + i * 46, y = 90 + i * 46;
    let chat = null;
    try { chat = App.createChatBox(Math.round(x), Math.round(y), null, true); } catch (e) { chat = null; }
    if (!chat) { console.warn('[ZFCrew] createChatBox 被拦截（窗口数量限制？）:', crewId); return null; }
    const boxEl = chat.el ? chat.el : chat;
    const pack = buildPack(crewId, role) + (task ? '\n【本次任务描述】\n' + task + '\n' : '');
    // 轮询等输入框+发送按钮就绪后注入派单消息并触发发送（每 300ms 最多 20 次 = 6 秒）
    (function _inject(tries) {
      tries = tries || 0;
      try {
        const input = boxEl.querySelector('textarea') || boxEl.querySelector('.chatbox-input') || boxEl.querySelector('input[type="text"]');
        const btn = boxEl.querySelector('.send-btn');
        if (input && btn && !input.value) {
          input.value = pack;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(function () { try { btn.click(); } catch (e) { console.warn('[ZFCrew] btn.click 失败:', e); } }, 60);
          return;
        }
      } catch (e) {}
      if (tries < 20) setTimeout(function () { _inject(tries + 1); }, 300);
      else console.warn('[ZFCrew] 派单消息注入失败:', crewId);
    })(0);
    return chat;
  }

  // ---------- v2：黑板进度面板 ----------
  let panelEl = null, panelCrewId = null, panelTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  function renderBoard(board) {
    if (!panelEl) return;
    const slices = (board && board.slices) || [];
    const done = slices.filter(s => s.status === 'done').length;
    const closed = board && board.closed;
    let html = '<div style="font-weight:bold;margin-bottom:6px;">🐝 协作黑板 ' + esc(panelCrewId)
      + ' <span style="font-weight:normal;color:#888;">' + done + '/' + slices.length + ' 片完成'
      + (closed ? ' · 已收口' : '') + '</span></div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">'
      + '<tr style="color:#888;text-align:left;"><th style="padding:2px 4px;">片</th><th>状态</th><th>认领窗</th><th>摘要</th><th></th></tr>';
    const now = Date.now() / 1000;
    const timeout = Math.min(parseInt(board && board.claim_timeout || 0, 10) || 600, 3600);
    for (const s of slices) {
      let st, color;
      if (s.status === 'done') { st = '✅ done'; color = '#2a2'; }
      else if (s.status === 'claimed') {
        const left = Math.max(0, timeout - (now - (s.claimed_at || 0)));
        st = '🔧 施工中' + (left < 120 ? '（超时回收剩 ' + Math.ceil(left) + 's）' : '');
        color = left < 120 ? '#c80' : '#26c';
      } else { st = '⏳ pending'; color = '#888'; }
      // v6：done 摘要悬浮展示完整内容；claimed 片带强制回收按钮（死窗占片救援）
      const canRelease = s.status === 'claimed';
      html += '<tr><td style="padding:2px 4px;"><b>' + esc(s.id) + '</b> ' + esc(s.title) + '</td>'
        + '<td style="color:' + color + ';">' + st + '</td>'
        + '<td>' + esc(s.claimed_by || s.claimed_by_prev || '-') + '</td>'
        + '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(s.done_summary || '') + '">'
        + esc(s.done_summary || '-') + '</td>'
        + '<td>' + (canRelease ? '<button class="zf-crew-release" data-slice="' + esc(s.id) + '" data-w="' + esc(s.claimed_by || '') + '" title="强制回收该片为 pending（死窗占片救援）" style="border:none;background:none;cursor:pointer;color:#c33;font-size:11px;">♻️回收</button>' : '') + '</td></tr>';
    }
    html += '</table>';
    // v6：总线最近 10 条只读展示
    html += '<div id="zf-crew-bus" style="margin-top:8px;border-top:1px dashed #ddd;padding-top:6px;font-size:11px;color:#666;max-height:110px;overflow:auto;"><span style="color:#aaa;">总线加载中…</span></div>';
    if (board && board.merge_failed) {
      html += '<div style="margin-top:6px;color:#c33;">⚠ 合并失败：' + esc(board.merge_error || '未知错误')
        + '（现场分支 ' + esc(board.branch || '') + ' 已保留，可重新回笼让审核员重试合并）</div>';
    }
    if (closed) html += '<div style="margin-top:6px;color:#2a2;">✔ 现场已收口完成（黑板归档），可关闭面板。</div>';
    else if (done === slices.length && slices.length) {
      html += '<div id="zf-crew-recall-wrap" style="margin-top:8px;display:flex;justify-content:flex-end;"></div>';
    }
    panelEl.innerHTML = html;
    // v6：强制回收按钮（点击瞬间以 board 状态为准，二次确认后调 force-release）
    panelEl.querySelectorAll('.zf-crew-release').forEach(b => {
      b.onclick = async () => {
        const sid = b.getAttribute('data-slice'), w = b.getAttribute('data-w');
        if (!confirm('确认强制回收分片「' + sid + '」？\n原认领窗 ' + (w || '-') + ' 将被广播告知停止施工该片。')) return;
        b.disabled = true;
        try {
          const r = await api('force-release', { crew_id: panelCrewId, slice_id: sid, by: 'panel' });
          if (!r.ok) alert('回收失败：' + (r.error || '未知错误'));
        } catch (e) { alert('回收异常：' + e.message); }
        pollBoard();
      };
    });
    // v6：总线尾巴拉取（最近 10 条）
    (async () => {
      const busEl = panelEl.querySelector('#zf-crew-bus');
      if (!busEl) return;
      try {
        const r = await api('bus-tail', { crew_id: panelCrewId, last_n: 10 });
        if (!r.ok) { busEl.textContent = '总线读取失败'; return; }
        if (!r.messages.length) { busEl.innerHTML = '<span style="color:#aaa;">总线暂无消息</span>'; return; }
        busEl.innerHTML = r.messages.map(m => '<div style="margin:1px 0;">'
          + '<span style="color:#26c;">[' + esc(m.from || '?') + ']</span> ' + esc(m.text || '')
          + (m.to ? ' <span style="color:#c80;">@' + esc(m.to) + '</span>' : '') + '</div>').join('');
        busEl.scrollTop = busEl.scrollHeight;
      } catch (e) { busEl.textContent = '总线读取异常'; }
    })();
    const recallWrap = panelEl.querySelector('#zf-crew-recall-wrap');
    if (recallWrap && !closed) {
      // v6 回笼前置校验：全片 done 且摘要非空才亮按钮，否则显示缺失原因
      const empty = slices.filter(s => s.status === 'done' && !(s.done_summary || '').trim()).map(s => s.id);
      if (empty.length) {
        recallWrap.innerHTML = '<span style="color:#c80;font-size:12px;">以下片摘要为空，暂不可回笼：' + esc(empty.join(', ')) + '</span>';
      } else {
        /* 【v27 外观统一】回笼按钮改为审核员/赛马同款橙色汇聚箭头造型（粗杆+双翼箭簇+徽章），功能仍是一次点击回笼 */
        recallWrap.innerHTML = '<button id="zf-crew-recall" title="一键回笼：开审核员窗收口（读黑板核验→逐片验收→合并分支）" style="border:none;background:none;padding:0;cursor:pointer;filter:drop-shadow(0 0 8px rgba(245,158,11,.9));">'
          + '<svg width="200" height="64" viewBox="0 0 200 64" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;display:block;">'
          + '<line x1="6" y1="32" x2="118" y2="32" stroke="#f59e0b" stroke-width="9" stroke-linecap="round" stroke-dasharray="14 10"/>'
          + '<polygon points="112,4 194,32 112,60" fill="#f59e0b" stroke="#fcd34d" stroke-width="3"/>'
          + '<g><rect x="46" y="17" width="88" height="30" rx="15" fill="#b45309" opacity="0.96"/>'
          + '<text x="90" y="37" text-anchor="middle" font-size="13" font-weight="bold" fill="#fff" font-family="sans-serif">📤 一键回笼</text></g>'
          + '<style>#zf-crew-recall line{animation:zfcrewFlow 1s linear infinite;}@keyframes zfcrewFlow{to{stroke-dashoffset:-24;}}</style>'
          + '</svg></button>';
        const recallBtn = panelEl.querySelector('#zf-crew-recall');
        recallBtn.onclick = recallCrew;
      }
    }
  }

  /* v5/v6 一键回笼：零输入 + 内联二次确认条（防误触 git 合并） */
  let recallArmed = false;
  function recallCrew() {
    const crewId = panelCrewId;
    if (!crewId) return;
    /* 【v9 修复】window.createChatBox / window.sendToChatbox 不存在（同 worker 窗根因），改用
       App.createChatBox + 轮询注入审核员素材包，与 openWorkerWindow 同口径。 */
    if (!window.App || typeof App.createChatBox !== 'function') { alert('前台缺 App.createChatBox，无法开审核员窗'); return; }
    let cb = null;
    try { cb = App.createChatBox(90, 90, null, true); } catch (e) { cb = null; }
    if (!cb) { alert('建审核员窗失败（窗口数量限制？）'); return; }
    const boxEl = cb.el ? cb.el : cb;
    const pack = buildReviewerPack(crewId) + '\n请立即开始收口：读黑板核验 → 逐片验收 → 合并分支 → close 黑板（合并失败时 POST /api/crew/close 传 merge_failed:true 及 merge_error，黑板会保留现场分支供重试）。';
    (function _inject(tries) {
      tries = tries || 0;
      let ok = false;
      try {
        const input = boxEl.querySelector('textarea') || boxEl.querySelector('.chatbox-input') || boxEl.querySelector('input[type="text"]');
        const btn = boxEl.querySelector('.send-btn');
        if (input && btn && !input.value) {
          input.value = pack;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(function () { try { btn.click(); } catch (e) { console.warn('[ZFCrew] 审核员派单 btn.click 失败:', e); } }, 60);
          ok = true;
        }
      } catch (e) {}
      if (!ok && tries < 20) setTimeout(function () { _inject(tries + 1); }, 300);
      else if (!ok) console.warn('[ZFCrew] 审核员素材包注入失败:', crewId);
    })(0);
    // v6 二次确认：第一次点变确认条，再点才真正派出审核员
    if (!recallArmed) {
      recallArmed = true;
      const wrap = panelEl && panelEl.querySelector('#zf-crew-recall-wrap');
      if (wrap) wrap.innerHTML = '<span style="font-size:12px;color:#555;">确认派出审核员合并分支？</span> '
        + '<button id="zf-crew-recall-yes" style="padding:5px 14px;background:#e6782a;color:#fff;border:none;border-radius:6px;cursor:pointer;">确认回笼</button> '
        + '<button id="zf-crew-recall-no" style="padding:5px 12px;">取消</button>';
      if (wrap) {
        wrap.querySelector('#zf-crew-recall-yes').onclick = recallCrew;
        wrap.querySelector('#zf-crew-recall-no').onclick = () => { recallArmed = false; pollBoard(); };
      }
      // 8s 未确认自动还原，避免面板停留时误触
      setTimeout(() => { if (recallArmed) { recallArmed = false; const w = panelEl && panelEl.querySelector('#zf-crew-recall-wrap'); if (w) pollBoard(); } }, 8000);
      return;
    }
    recallArmed = false;
    // 旧全局函数不存在，已上移改用 App.createChatBox + 注入
    const btn = panelEl && panelEl.querySelector('#zf-crew-recall-wrap');
    if (btn) btn.innerHTML = '<span style="color:#888;font-size:12px;">审核员已派出…（合并失败会在面板显示错误，可重新回笼重试）</span>';
  }

  async function pollBoard() {
    if (!panelEl || !panelCrewId) return;
    try {
      const r = await api('board', { crew_id: panelCrewId });
      if (r.ok) renderBoard(r.board);
    } catch (e) { /* 静默，下轮重试 */ }
  }

  function openPanel(crewId) {
    panelCrewId = crewId;
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.style.cssText = 'position:fixed;right:12px;bottom:104px;width:520px;max-height:50vh;overflow:auto;'
        + 'background:#fff;border:1px solid #ccc;border-radius:8px;padding:10px;box-shadow:0 4px 16px rgba(0,0,0,.15);z-index:9998;';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'position:absolute;top:4px;right:6px;border:none;background:none;cursor:pointer;color:#888;';
      closeBtn.onclick = closePanel;
      panelEl.appendChild(closeBtn);
      document.body.appendChild(panelEl);
    }
    panelEl.style.display = 'block';
    pollBoard();
    if (panelTimer) clearInterval(panelTimer);
    panelTimer = setInterval(pollBoard, 10000); // 10s 轮询，弱沟通不推送
  }

  function closePanel() {
    if (panelEl) panelEl.style.display = 'none';
    if (panelTimer) { clearInterval(panelTimer); panelTimer = null; }
    panelCrewId = null;
  }

  // ---------- 按钮注入（v27：黑板是后台运维面板，前台不显示按钮；openPanel 保留供代码调用） ----------
  function mount() {
    return; /* 不再注入前台按钮，黑板仅后台可见 */
  }
  function mountLegacyButton() {
    if (document.getElementById('zf-crew-panel-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'zf-crew-panel-btn';
    btn.textContent = '📋 施工黑板';
    btn.title = '查看/管理协作队黑板：强制回收分片、一键回笼开审核员';
    btn.style.cssText = 'position:fixed;right:12px;bottom:104px;z-index:9997;padding:8px 14px;background:#fff;border:1px solid #ccc;border-radius:20px;box-shadow:0 2px 10px rgba(0,0,0,.15);cursor:pointer;font-size:12px;';
    btn.onclick = () => {
      let crewId = panelCrewId || '';
      if (!crewId) {
        try { crewId = (JSON.parse(localStorage.getItem('zf_crew_recent') || '[]').filter(id => { try { const b = JSON.parse(localStorage.getItem('zf_crew_board_' + id) || 'null'); return !b || !b.closed; } catch (e) { return true; } })[0]) || ''; } catch (e) {}
      }
      if (!crewId) {
        try { crewId = (JSON.parse(localStorage.getItem('zf_crew_recent') || '[]')[0]) || ''; } catch (e) {}
      }
      if (!crewId) { alert('还没有进行过协作队开工，无黑板可看'); return; }
      openPanel(crewId);
    };
    document.body.appendChild(btn);
  }

  function rememberCrew(crewId) {
    try {
      const recent = JSON.parse(localStorage.getItem('zf_crew_recent') || '[]');
      const list = [crewId].concat(recent.filter(x => x !== crewId)).slice(0, 8);
      localStorage.setItem('zf_crew_recent', JSON.stringify(list));
    } catch (e) { /* 忽略 */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  /* 【v21 箭头往复】挂起队重新开工：用原 crew_id 复活（黑板仍 open，不调 create 直接开窗）。
     resumePair(team) → team 传形如 "worker-1" 的队名或完整 crew_id。
     【v13 收口】opts.crewId / opts.srcChatId 由箭头层 pair 传入（优先），recent[0] 仅作兜底，
     防多队挂起时一律复活「最近一次」造成串台。 */
  async function resumeCrew(team, opts) {
    opts = opts || {};
    let crewId = opts.crewId || '';
    if (!crewId) {
      const recent = JSON.parse(localStorage.getItem('zf_crew_recent') || '[]');
      crewId = recent[0] || '';
    }
    if (!crewId) { alert('没有可复活的协作队记录'); return false; }
    let board = null;
    try { const r = await api('board', { crew_id: crewId }); if (r.ok) board = r.board; } catch (e) {}
    const slices = (board && board.slices) || [];
    const srcId = opts.srcChatId || null; /* 复活窗连线由箭头层维护（suspended pair 已有 srcId） */
    const n = Math.max(1, slices.filter(s => s.id !== 'auto').length || 1);
    for (let i = 0; i < n; i++) {
      const chat = openWorkerWindow(crewId, 'worker', '', i);
      if (chat) _bindCrewWindow(chat, crewId, 'worker-' + (i + 1), srcId);
    }
    return true;
  }

  window.ZFCrew = { api, buildPack, buildReviewerPack, dispatchCrew, openPanel, closePanel, openWorkerWindow, resumeCrew };
})();
