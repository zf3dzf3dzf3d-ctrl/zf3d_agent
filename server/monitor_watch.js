// Monitor all existing chat windows and recover interrupted work.
// [防风暴版 v2] 四道护栏：
//   1. 单轮最多恢复 MAX_RECOVER_PER_CYCLE 个窗口（防止一轮群发几百个）
//   2. 每窗口最多尝试 MAX_ATTEMPTS_PER_WINDOW 次（防止"继续"死循环）
//   3. 只恢复 ACTIVE_WINDOW_MS 内活跃的窗口（几天前的死窗口不复活）
//   4. 目标窗口必须真实存在于 chat_history（后端亦有二次校验）
const http = require('http');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '.monitor_log.txt');
const STATE_FILE = path.join(__dirname, '.monitor_state.json');
const API_HOST = '127.0.0.1';
// 端口与 config.py 保持一致：默认 8421，private/port.txt 可覆盖
let API_PORT = 8421;
try {
  const t = fs.readFileSync(path.join(__dirname, '..', 'private', 'port.txt'), 'utf8').trim();
  const p = parseInt(t, 10);
  if (p >= 1 && p <= 65535) API_PORT = p;
} catch (e) {}
const RECOVERY_TEXT = '继续';
const MAX_RECOVER_PER_CYCLE = 5;          // 护栏1：单轮最多恢复窗口数
const MAX_ATTEMPTS_PER_WINDOW = 3;        // 护栏2：每窗口累计最多尝试次数
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;  // 护栏3：只处理30分钟内活跃的窗口
const NETWORK_ERROR = /断网|连接失败|连接中断|network error|ECONN|socket hang up/i;

function callMonitor(action, extra) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(Object.assign({ action }, extra || {}));
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/tools/monitor',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (error) { resolve({ error: body.substring(0, 500) }); }
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('monitor request timeout')));
    req.on('error', error => resolve({ error: error.message }));
    req.write(payload);
    req.end();
  });
}

function textOf(message) {
  return String(message && message.content || '');
}

function isComplete(messages) {
  return messages.some(message => /task_complete|任务完成|已完成/.test(textOf(message)));
}

function needsRecovery(messages) {
  if (!messages.length || isComplete(messages)) return false;
  const last = messages[messages.length - 1];
  const text = textOf(last);
  return last.role === 'tool_call' || NETWORK_ERROR.test(text);
}

// [护栏2状态持久化] 记录每个窗口的恢复尝试次数，跨轮次累计
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (error) { return { attempts: {} }; }
}
function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (error) {}
}

async function check() {
  const timestamp = new Date().toISOString();
  const now = Date.now();
  const state = loadState();
  const listResult = await callMonitor('list');
  if (!listResult.ok || !Array.isArray(listResult.sessions)) {
    const line = `[${timestamp}] monitor unavailable: ${JSON.stringify(listResult)}\n`;
    fs.appendFileSync(LOG_FILE, line);
    console.log(line.trim());
    return false;
  }

  // [护栏3] 只处理最近 ACTIVE_WINDOW_MS 内有活动的窗口
  const sessions = listResult.sessions.filter(session =>
    session.session_id && session.last_activity && (now - session.last_activity) < ACTIVE_WINDOW_MS);
  // [护栏2] 剔除已达尝试上限的窗口
  const eligible = sessions.filter(session => (state.attempts[session.session_id] || 0) < MAX_ATTEMPTS_PER_WINDOW);

  const ids = eligible.map(session => session.session_id);
  const results = ids.length ? (await callMonitor('status', { session_ids: ids, limit: 6 })).results || [] : [];
  const recovered = [];
  let unfinished = 0;

  for (const result of results) {
    const messages = result.messages || [];
    if (!isComplete(messages)) unfinished += 1;
    if (needsRecovery(messages)) {
      // [护栏1] 单轮上限，达到即停止
      if (recovered.length >= MAX_RECOVER_PER_CYCLE) {
        fs.appendFileSync(LOG_FILE, `[${timestamp}] recover limit reached (${MAX_RECOVER_PER_CYCLE}), skip ${result.session_id}\n`);
        break;
      }
      state.attempts[result.session_id] = (state.attempts[result.session_id] || 0) + 1;
      const sent = await callMonitor('send', { chat_id: result.session_id, message: RECOVERY_TEXT });
      if (sent.ok !== false && !sent.error) {
        recovered.push(result.session_id);
      } else {
        // [护栏4] 后端拒绝（窗口不存在等）→ 立即放弃并记满次数，永不重试
        state.attempts[result.session_id] = MAX_ATTEMPTS_PER_WINDOW;
        fs.appendFileSync(LOG_FILE, `[${timestamp}] rejected ${result.session_id}: ${sent.error || 'unknown'}\n`);
      }
    }
  }

  // 已完成/已放弃的窗口从状态中清理，防止状态文件无限膨胀
  const doneIds = new Set(results.filter(r => isComplete(r.messages || [])).map(r => r.session_id));
  for (const id of doneIds) delete state.attempts[id];
  saveState(state);

  const summary = `[${timestamp}] active=${sessions.length} eligible=${eligible.length} unfinished=${unfinished} recovered=${recovered.join(',') || 'none'}\n`;
  fs.appendFileSync(LOG_FILE, summary);
  console.log(summary.trim());
  if (unfinished === 0 && sessions.length > 0) console.log('ALL_DONE');
  return unfinished === 0;
}

check().catch(error => {
  const line = `[${new Date().toISOString()}] monitor error: ${error.stack || error}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.error(line.trim());
});
