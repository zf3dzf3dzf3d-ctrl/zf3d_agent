/**
 * 神经元对话实验 — Canvas可视化 + 对话交互
 * 1. 事件队列驱动：粒子到达后才处理下一个事件，最低0.1s间隔
 * 2. 摄像机系统：追踪所有可见神经元中心，平滑滞后跟随
 * 3. 每次新对话重置神经元位置
 * 4. Web Audio API音效：神经元激活时播放柔和正弦波
 */

// ===== 全局状态 =====
// API前缀：嵌入主系统时指向neuron-api路由，独立运行时用空
const API_BASE = window.location.port === '8765' ? '/neuron-api' : '';
const canvas = document.getElementById('brain-canvas');
const ctx = canvas.getContext('2d');
const messagesEl = document.getElementById('messages');
const consoleBody = document.getElementById('console-body');
const inputBox = document.getElementById('input-box');
const sendBtn = document.getElementById('send-btn');
const 输入色 = { r: 46, g: 220, b: 180 };
const 输出色 = { r: 255, g: 165, b: 60 };
let camera = { x: 0, y: 0, targetX: 0, targetY: 0, scale: 1, targetScale: 1, userOffsetX: 0, userOffsetY: 0 };
let dpr = window.devicePixelRatio || 1;
let canvasW = 0, canvasH = 0;
let isSending = false;
let abortController = null;
let _lastUserMessage = '';  // 保存最后一次用户消息，供选项点击时恢复上下文
let 动画启用 = true;  // 动画开关——关闭时所有delay为0，粒子瞬间到达
try { const savedAnim = localStorage.getItem('animEnabled'); if (savedAnim === 'false') 动画启用 = false; } catch(e) {}
let 动画速度 = 4.0;  // 动画速度倍率，1.0=原始速度，4.0=4倍速
try { const saved = parseFloat(localStorage.getItem('animSpeed')); if (saved > 0) 动画速度 = saved; } catch(e) {}
let 路线图模式 = false;  // 路线图执行模式——前端预布局节点+显示横幅
let 当前路线图卡片 = null;  // 当前正在执行的路线图卡片引用（execBtn + 状态栏）
let reactGraph = null;  // ReAct实时节点图状态
let 当前对话ID = '';

// ===== Web Audio 音效 =====
let audioCtx = null;
let 声音启用 = true;
try { const savedSound = localStorage.getItem('soundEnabled'); if (savedSound === 'false') 声音启用 = false; } catch(e) {}
// 五声音阶池，每次随机选一个音
const 音阶池 = [523.25, 587.33, 659.25, 698.46, 783.99, 880.00, 987.77, 1046.50];

function 播放音效(神经元名) {
    if (!声音启用) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const 频率 = 音阶池[Math.floor(Math.random() * 音阶池.length)];
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 频率;
    // ADSR包络：快速起音+柔和衰减
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.01);   // Attack 10ms
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6); // Decay 600ms
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
}

function 播放传输音(低音) {
    if (!声音启用) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const 池 = 低音 ? [261.63, 293.66, 329.63] : [659.25, 698.46, 783.99]; // 输入低音/输出高音
    const 频率 = 池[Math.floor(Math.random() * 池.length)];
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 频率;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(now); osc.stop(now + 0.3);
}

function 生成对话ID() {
    const a = Date.now().toString(36);
    const b = Math.random().toString(36).slice(2, 8);
    return a + b;
}

function 新建对话() {
    当前对话ID = 生成对话ID();
    messagesEl.innerHTML = '';
    eventQueue = []; processingEvent = false;
    隐藏横幅();
    路线图模式 = false;
    当前路线图卡片 = null;
    log('系统', `🆕 新建对话 ${当前对话ID}`);
}
// 兼容面板布局.js的调用
function newConversation() { 新建对话(); }

当前对话ID = 生成对话ID();

// 神经元数据——全部初始不可见，用时出现用完消失
let neurons = [];
let synapses = [];
let particles = [];
let eventQueue = [];
let processingEvent = false;

// 重置所有神经元到初始状态（只重置可见性，不删除）
function resetNeurons() {
    resetDisplay();
    eventQueue = [];
    processingEvent = false;
}

// 只重置画布显示（不清空事件队列）——路线图开始/结束时用
function resetDisplay() {
    neurons.forEach(n => {
        n.透明度 = 0; n.目标透明度 = 0; n.激活度 = 0;
        n.脉冲 = []; n.思考气泡 = null; n.生命周期 = 0;
        n.x = 0; n.y = 0;  // 重置位置，下次出现时重新生成
    });
    synapses = [];    // 清空突触，由传播事件逐条添加，确保先定位再连线
    particles = [];
    _神经元序号 = 0;  // 重置累计计数器
    // 重置摄像机，确保第一个节点居中
    camera.x = 0; camera.y = 0; camera.targetX = 0; camera.targetY = 0; camera.scale = 1; camera.targetScale = 1; camera.userOffsetX = 0; camera.userOffsetY = 0;
}

// ===== 圆角矩形 =====
function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// ===== 画布 =====
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvasW = rect.width; canvasH = rect.height;
    canvas.width = canvasW * dpr; canvas.height = canvasH * dpr; ctx.scale(dpr, dpr);
}
window.addEventListener('resize', resizeCanvas);

// ===== 摄像机 =====
// 自动跟踪始终运行，用户缩放/平移作为叠加偏移
function updateCamera() {
    camera.scale += (camera.targetScale - camera.scale) * 0.12;
    const visible = neurons.filter(n => n.目标透明度 > 0.1);
    if (visible.length > 0) {
        let cx = 0, cy = 0;
        visible.forEach(n => { cx += n.x; cy += n.y; });
        cx /= visible.length; cy /= visible.length;
        camera.targetX = cx - canvasW / 2 + camera.userOffsetX;
        camera.targetY = cy - canvasH / 2 + camera.userOffsetY;
    }
    camera.x += (camera.targetX - camera.x) * 0.04;
    camera.y += (camera.targetY - camera.y) * 0.04;
}

// ===== 神经元位置 =====
function makeNeuron(name, icon, layer) {
    return { 名称: name, 图标: icon, 层: layer, x: 0, y: 0, 激活度: 0, 脉冲: [], 激活次数: 0, 透明度: 0, 目标透明度: 0, 思考气泡: null, 生命周期: 0 };
}

let _神经元序号 = 0;  // 累计计数器，每次新节点出现+1，保证绝对间距

function 生成随机位置() {
    _神经元序号 += 1;
    return {
        x: canvasW / 2 + (Math.random() - 0.5) * 30,
        y: canvasH / 2 - _神经元序号 * 100
    };
}

function getInputPort(n) { return { x: n.x, y: n.y }; }
function getOutputPort(n) { return { x: n.x, y: n.y }; }

function 显示神经元(名称) {
    const n = neurons.find(n => n.名称 === 名称);
    if (n) {
        if (n.透明度 < 0.01 && n.x === 0 && n.y === 0) { const p = 生成随机位置(); n.x = p.x; n.y = p.y; }
        n.目标透明度 = 1;
        n.生命周期 = Date.now();
    }
}

// ===== 背景 =====
const stars = [];
for (let i = 0; i < 60; i++) stars.push({ x: Math.random()*2000, y: Math.random()*2000, r: Math.random()*1.2+0.3, a: Math.random()*0.3+0.05, phase: Math.random()*Math.PI*2 });
function drawBackground(time) {
    const g = ctx.createRadialGradient(canvasW/2, canvasH/2, 0, canvasW/2, canvasH/2, Math.max(canvasW, canvasH));
    g.addColorStop(0, '#0d0d20'); g.addColorStop(1, '#070710');
    ctx.fillStyle = g; ctx.fillRect(0, 0, canvasW, canvasH);
    stars.forEach(s => {
        const tw = Math.sin(time*0.001+s.phase)*0.15+0.85;
        ctx.beginPath(); ctx.arc(s.x%canvasW, s.y%canvasH, s.r, 0, Math.PI*2);
        ctx.fillStyle = `rgba(120,140,200,${s.a*tw})`; ctx.fill();
    });
}

const layerColors = { '感知':{r:74,g:158,b:255}, '记忆':{r:155,g:89,b:182}, '思考':{r:241,g:196,b:15}, '行动':{r:230,g:126,b:34}, '输出':{r:46,g:204,b:113}, '控制':{r:149,g:165,b:166}, '通信':{r:74,g:158,b:255}, '验证':{r:46,g:204,b:113}, '角色':{r:155,g:89,b:182} };
function getLayerColor(l) { return layerColors[l] || {r:149,g:165,b:166}; }

// ===== 绘制神经元 =====
const 生命周期秒 = 3000;

function 更新生命周期() {
    const now = Date.now();
    neurons.forEach(n => { if (n.生命周期 && n.目标透明度 > 0 && now - n.生命周期 > 生命周期秒) n.目标透明度 = 0; });
}

function drawNeuron(n, time) {
    n.透明度 += (n.目标透明度 - n.透明度) * 0.08;
    if (n.透明度 < 0.01 && n.目标透明度 === 0) { n.透明度 = 0; return; }
    const a = n.透明度, {r,g,b} = getLayerColor(n.层), br = 32;
    const as = Math.min(1, a*1.5), breathe = Math.sin(time*0.002)*0.05+1;
    const radius = br * breathe * (1 + n.激活度*0.3) * as;
    if (n.激活度 > 0.01) {
        const gr = radius*(2.5+n.激活度*2), gl = ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,gr);
        gl.addColorStop(0, `rgba(${r},${g},${b},${0.35*n.激活度*a})`);
        gl.addColorStop(0.5, `rgba(${r},${g},${b},${0.1*n.激活度*a})`); gl.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = gl; ctx.fillRect(n.x-gr,n.y-gr,gr*2,gr*2);
    }
    const ig = ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,radius*1.8);
    ig.addColorStop(0, `rgba(${r},${g},${b},${(0.15+n.激活度*0.3)*a})`); ig.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = ig; ctx.fillRect(n.x-radius*2,n.y-radius*2,radius*4,radius*4);
    n.脉冲 = n.脉冲.filter(p => p.life > 0);
    n.脉冲.forEach(p => {
        const pr = radius+(1-p.life)*80; ctx.beginPath(); ctx.arc(n.x,n.y,pr,0,Math.PI*2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${p.life*0.5*a})`; ctx.lineWidth = 2*p.life; ctx.stroke(); p.life -= 0.015;
    });
    const bg = ctx.createRadialGradient(n.x-radius*0.3,n.y-radius*0.3,0,n.x,n.y,radius);
    bg.addColorStop(0, `rgba(${Math.min(r+60,255)},${Math.min(g+60,255)},${Math.min(b+60,255)},${(0.4+n.激活度*0.5)*a})`);
    bg.addColorStop(1, `rgba(${r},${g},${b},${(0.15+n.激活度*0.3)*a})`);
    ctx.beginPath(); ctx.arc(n.x,n.y,radius,0,Math.PI*2); ctx.fillStyle = bg; ctx.fill();
    ctx.beginPath(); ctx.arc(n.x,n.y,radius,0,Math.PI*2);
    ctx.strokeStyle = `rgba(${r},${g},${b},${(0.6+n.激活度*0.4)*a})`; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = `${22*as}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = a;
    ctx.fillText(n.图标, n.x, n.y-2); ctx.globalAlpha = 1;
    ctx.font = '12px "Microsoft YaHei", sans-serif'; ctx.fillStyle = `rgba(200,200,224,${(0.6+n.激活度*0.4)*a})`;
    ctx.fillText(n.名称, n.x, n.y+radius+16);
    if (n.激活次数 > 0) { ctx.font = '10px "Microsoft YaHei", sans-serif'; ctx.fillStyle = `rgba(100,100,140,${0.5*a})`; ctx.fillText(`×${n.激活次数}`, n.x, n.y+radius+30); }
    if (n.思考气泡 && n.思考气泡.life > 0 && a > 0.1) {
        const ba = n.思考气泡.life*a, bx = n.x, by = n.y-radius-12, text = n.思考气泡.text;
        ctx.font = '11px "Microsoft YaHei", sans-serif'; const tw = ctx.measureText(text).width, bw = tw+20, bh = 24;
        ctx.fillStyle = `rgba(20,20,35,${0.85*ba})`; ctx.strokeStyle = `rgba(${r},${g},${b},${0.6*ba})`; ctx.lineWidth = 1;
        roundRect(ctx, bx-bw/2, by-bh, bw, bh, 6); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx-4,by); ctx.lineTo(bx+4,by); ctx.lineTo(bx,by+6); ctx.closePath();
        ctx.fillStyle = `rgba(20,20,35,${0.85*ba})`; ctx.fill();
        ctx.fillStyle = `rgba(200,210,240,${ba})`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, bx, by-bh/2); n.思考气泡.life -= 0.002;
    }
    n.激活度 *= 0.96; if (n.激活度 < 0.01) n.激活度 = 0;
}

// ===== 突触 =====
function drawSynapse(s, time) {
    const from = neurons.find(n => n.名称===s.源), to = neurons.find(n => n.名称===s.目标);
    if (!from || !to) return; const a = Math.min(from.透明度, to.透明度); if (a < 0.01) return;
    const fp = getOutputPort(from), tp = getInputPort(to), cp1x = fp.x+(tp.x-fp.x)*0.3, cp1y = fp.y, cp2x = fp.x+(tp.x-fp.x)*0.7, cp2y = tp.y;
    const g = ctx.createLinearGradient(fp.x, fp.y, tp.x, tp.y);
    g.addColorStop(0, `rgba(${输出色.r},${输出色.g},${输出色.b},${(0.3+s.权重*0.4)*a})`);
    g.addColorStop(1, `rgba(${输入色.r},${输入色.g},${输入色.b},${(0.3+s.权重*0.4)*a})`);
    ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tp.x, tp.y);
    ctx.strokeStyle = g; ctx.lineWidth = 1+s.权重*2; ctx.stroke();
}

// ===== 粒子 =====
function bezierPoint(t, p0, p1, p2, p3) { const mt = 1-t; return mt*mt*mt*p0+3*mt*mt*t*p1+3*mt*t*t*p2+t*t*t*p3; }
function drawParticleTrail(t, fp, tp, color, life) {
    const cp1x = fp.x+(tp.x-fp.x)*0.3, cp1y = fp.y, cp2x = fp.x+(tp.x-fp.x)*0.7, cp2y = tp.y;
    for (let i = 0; i < 6; i++) {
        const tt = Math.max(0, t-i*0.035), tx = bezierPoint(tt, fp.x, cp1x, cp2x, tp.x), ty = bezierPoint(tt, fp.y, cp1y, cp2y, tp.y);
        ctx.beginPath(); ctx.arc(tx, ty, 3-i*0.35, 0, Math.PI*2);
        ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${(1-i*0.15)*life*0.7})`; ctx.fill();
    }
    const x = bezierPoint(t, fp.x, cp1x, cp2x, tp.x), y = bezierPoint(t, fp.y, cp1y, cp2y, tp.y);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2);
    const pg = ctx.createRadialGradient(x, y, 0, x, y, 8);
    pg.addColorStop(0, `rgba(255,255,255,${life})`); pg.addColorStop(0.5, `rgba(${color.r},${color.g},${color.b},${life*0.5})`);
    pg.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`); ctx.fillStyle = pg; ctx.fillRect(x-8, y-8, 16, 16);
}
function drawParticles(time) {
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
        p.t += 0.025 * 动画速度;
        if (p.t >= 1) { p.life = 0; if (p.onArrive) p.onArrive(); return; }
        const t = p.t; let fp, tp, color;
        if (p.from === 'input') { const to = neurons.find(n => n.名称===p.to); if (!to) return; fp = { x: canvasW/2+camera.x, y: canvasH+camera.y }; tp = getInputPort(to); color = 输入色; }
        else if (p.to === 'output') { const from = neurons.find(n => n.名称===p.from); if (!from) return; fp = getOutputPort(from); tp = { x: canvasW/2+camera.x, y: canvasH+camera.y }; color = 输出色; }
        else { const from = neurons.find(n => n.名称===p.from), to = neurons.find(n => n.名称===p.to); if (!from||!to) return; fp = getOutputPort(from); tp = getInputPort(to); color = { r: Math.round(输出色.r+(输入色.r-输出色.r)*t), g: Math.round(输出色.g+(输入色.g-输出色.g)*t), b: Math.round(输出色.b+(输入色.b-输出色.b)*t) }; }
        drawParticleTrail(t, fp, tp, color, p.life); p.life -= 0.005;
    });
}

// ===== 主渲染 =====
function render(time) {
    updateCamera(); 更新生命周期();
    drawBackground(time); ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, canvasW, canvasH); ctx.clip();
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-canvasW / 2, -canvasH / 2);
    ctx.translate(-camera.x, -camera.y);
    synapses.forEach(s => drawSynapse(s, time)); drawParticles(time); neurons.forEach(n => drawNeuron(n, time));
    ctx.restore(); requestAnimationFrame(render);
}

// ===== 画布交互：滚轮缩放 + 中键平移（叠加在自动跟踪之上）=====
if (canvas) {
    // 滚轮缩放
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        camera.targetScale = Math.max(0.3, Math.min(5, camera.targetScale * delta));
    }, { passive: false });

    // 中键平移——修改userOffset，自动跟踪继续运行
    let isPanning = false, panStartX = 0, panStartY = 0, panOffX = 0, panOffY = 0;
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            isPanning = true;
            panStartX = e.clientX; panStartY = e.clientY;
            panOffX = camera.userOffsetX; panOffY = camera.userOffsetY;
            canvas.style.cursor = 'grabbing';
        }
    });
    document.addEventListener('mousemove', (e) => {
        if (isPanning) {
            const dx = (e.clientX - panStartX) / camera.scale;
            const dy = (e.clientY - panStartY) / camera.scale;
            camera.userOffsetX = panOffX - dx;
            camera.userOffsetY = panOffY - dy;
        }
    });
    document.addEventListener('mouseup', (e) => {
        if (isPanning) { isPanning = false; canvas.style.cursor = 'crosshair'; }
    });
}

// ===== 日志 =====
function log(tag, content, thought) {
    const now = new Date(), ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
    const line = document.createElement('div'); line.className = 'log-line';
    const maxLength = 120;
    const truncated = content.length > maxLength ? content.slice(0, maxLength) + '…' : content;
    let html = `<span class="log-tag log-${tag}">${tag}</span><span class="log-content">${truncated}</span><span class="log-time">${ts}</span>`;
    if (thought) {
        const tLen = thought.length;
        if (tLen > 80) {
            const tTrunc = thought.slice(0, 80) + '…';
            html += ` <span class="log-think">// <span class="log-think-short">${tTrunc}</span><div class="log-think-full" style="display:none">${renderMarkdown(thought)}</div><a class="log-think-toggle" href="javascript:void(0)">展开</a></span>`;
        } else {
            html += ` <span class="log-think">// ${thought}</span>`;
        }
    }
    line.innerHTML = html;
    consoleBody.appendChild(line); consoleBody.scrollTop = consoleBody.scrollHeight;
}
document.getElementById('console-clear').addEventListener('click', () => { consoleBody.innerHTML = ''; log('系统', '控制台已清空'); });

// 复制控制台全部日志
document.getElementById('console-copy').addEventListener('click', () => {
    const lines = consoleBody.querySelectorAll('.log-line');
    let text = '';
    lines.forEach(line => {
        const time = line.querySelector('.log-time')?.textContent || '';
        const tag = line.querySelector('.log-tag')?.textContent || '';
        const content = line.querySelector('.log-content')?.textContent || line.textContent || '';
        text += (time ? time + ' ' : '') + (tag ? tag + ' ' : '') + content + '\n';
    });
    if (!text) { log('系统', '控制台为空'); return; }
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('console-copy');
            const orig = btn.textContent;
            btn.textContent = '✅ 已复制';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        });
    } else {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        const btn = document.getElementById('console-copy');
        const orig = btn.textContent;
        btn.textContent = '✅ 已复制';
        setTimeout(() => { btn.textContent = orig; }, 1500);
    }
});

// 展开/收起思考气泡
consoleBody.addEventListener('click', (e) => {
    if (e.target.classList.contains('log-think-toggle')) {
        const parent = e.target.parentElement;
        const short = parent.querySelector('.log-think-short');
        const full = parent.querySelector('.log-think-full');
        if (short.style.display !== 'none') {
            short.style.display = 'none'; full.style.display = 'block'; e.target.textContent = '收起';
        } else {
            short.style.display = 'inline'; full.style.display = 'none'; e.target.textContent = '展开';
        }
    }
});

// ===== 对话 =====
function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
        marked.setOptions({ gfm: true, breaks: true, highlight: function(code, lang) {
            if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                try { return hljs.highlight(code, { language: lang }).value; } catch(e) {}
            }
            return code;
        }});
        let html = marked.parse(text);
        return html;
    }
    // 兜底：简单正则
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
}

function enhanceCodeBlocks(container) {
    // 为代码块添加复制按钮+语法高亮
    if (!container) return;
    container.querySelectorAll('pre code').forEach(block => {
        if (typeof hljs !== 'undefined' && !block.dataset.highlighted) {
            try { hljs.highlightElement(block); block.dataset.highlighted = '1'; } catch(e) {}
        }
        const pre = block.parentElement;
        if (pre && !pre.querySelector('.code-copy-btn')) {
            const btn = document.createElement('button');
            btn.className = 'code-copy-btn';
            btn.textContent = '📋';
            btn.title = '复制代码';
            btn.addEventListener('click', () => {
                const text = block.textContent;
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(() => { btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋', 1500); });
                } else {
                    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                    btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋', 1500);
                }
            });
            pre.appendChild(btn);
        }
    });
}

/**
 * 自动检测AI回复中的选项列表，渲染为可点击按钮
 * 匹配模式：消息中含2+个数字编号选项 + 末尾有询问词（请告诉我/请选择/你想做什么等）
 */
function renderClickableOptions(container) {
    if (!container) return;
    // 检测是否含询问词
    const text = container.textContent || '';
    const 询问词 = ['请告诉我', '请选择', '你想做什么', '您的具体需求', '请确认', '您想让我', '请说明', '需要我'];
    const 有询问 = 询问词.some(w => text.includes(w));
    if (!有询问) return;
    // 找有序列表项（marked渲染后是<li>）
    const items = container.querySelectorAll('li');
    if (!items || items.length < 2) return;
    // 只处理"选项不超过6个"的情况
    if (items.length > 6) return;
    // 确保列表项简短（<100字），太长的不算选项
    const 选项文本们 = [];
    items.forEach(li => {
        const t = li.textContent.trim();
        if (t && t.length < 100) 选项文本们.push(t);
    });
    if (选项文本们.length < 2) return;
    // 构建按钮HTML
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid #2a2a44;';
    选项文本们.forEach((opt) => {
        const btn = document.createElement('button');
        btn.className = 'auto-option-btn';
        btn.textContent = opt;
        btn.style.cssText = 'text-align:left;background:#0d0d18;border:1px solid #2a2a44;border-radius:6px;padding:8px 12px;color:#c8c8e0;font-size:13px;cursor:pointer;font-family:inherit;transition:all 0.15s;';
        btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#4a9eff'; btn.style.background = '#14142a'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#2a2a44'; btn.style.background = '#0d0d18'; });
        btn.addEventListener('click', () => {
            // 点击选项后自动发送
            const inputBox = document.getElementById('input-box');
            if (inputBox) {
                inputBox.value = opt;
                inputBox.focus();
                // 自动触发发送
                const sendBtn = document.getElementById('send-btn');
                if (sendBtn) sendBtn.click();
            }
        });
        btnContainer.appendChild(btn);
    });
    // 插入到消息末尾
    container.appendChild(btnContainer);
}

function addMessage(role, text) {
    const div = document.createElement('div'); div.className = `msg ${role}`;
    if (role === 'assistant') { div.innerHTML = renderMarkdown(text); enhanceCodeBlocks(div); renderClickableOptions(div); }
    else { div.textContent = text; }
    messagesEl.appendChild(div); messagesEl.scrollTop = messagesEl.scrollHeight; return div;
}
function activateNeuron(name, thought) {
    const n = neurons.find(n => n.名称===name);
    if (n) { n.激活度 = 1.0; n.脉冲.push({life:1}); n.激活次数 = (n.激活次数||0)+1; n.生命周期 = Date.now(); if (thought) setTimeout(() => { n.思考气泡 = {text:thought,life:1}; }, 200); 播放音效(name); }
}
function sendSignal(from, to, onArrive) { particles.push({from, to, t:0, life:1, onArrive}); }
function delay(ms) { return new Promise(r => setTimeout(r, 动画启用 ? ms / 动画速度 : 0)); }
function waitForParticle(from, to) {
    if (!动画启用) return Promise.resolve();  // 动画关闭时跳过粒子等待
    return new Promise(resolve => { let done = false; const cb = () => { if (!done) { done = true; resolve(); } }; sendSignal(from, to, cb); setTimeout(cb, 10000); });
}

// 预先设位置不让粒子飞向(0,0)，但不显示
function 预定位(名称) {
    const n = neurons.find(n => n.名称 === 名称);
    if (n && n.透明度 < 0.01) { const p = 生成随机位置(); n.x = p.x; n.y = p.y; }
}

function 显示横幅(文本, 色) {
    let banner = document.getElementById('canvas-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'canvas-banner';
        document.getElementById('canvas-area').appendChild(banner);
    }
    banner.textContent = 文本;
    banner.style.borderColor = 色 || '#4a9eff';
    banner.style.color = 色 || '#4a9eff';
    banner.style.display = 'block';
}

function 隐藏横幅() {
    let banner = document.getElementById('canvas-banner');
    if (banner) banner.style.display = 'none';
}

// ===== 文件变更可视化卡片 =====
const 操作图标 = {
    write_file: '✏️', create_file: '📄', replace_text: '🔄',
    append_file: '➕', insert_lines: '📥', delete_lines: '❌', move_file: '📦',
    delete_file: '🗑️'
};
const 操作名 = {
    write_file: '写入文件', create_file: '创建文件', replace_text: '替换文本',
    append_file: '追加内容', insert_lines: '插入行', delete_lines: '删除行', move_file: '移动文件',
    delete_file: '删除文件'
};

function renderFileChangeCard(d) {
    const 操作 = d.操作 || 'write_file';
    const 路径 = d.路径 || '';
    const 文件名 = 路径.split(/[\\/]/).pop() || 路径;
    const 统计 = d.统计 || {};
    const 新增行 = 统计.新增行 || 0;
    const 删除行 = 统计.删除行 || 0;
    const 旧行数 = d.旧行数 || 0;
    const 新行数 = d.新行数 || 0;

    // 创建卡片
    const card = document.createElement('div');
    card.className = 'msg assistant file-change-card';
    card.innerHTML = `
        <div class="fc-header">
            <span class="fc-icon">${操作图标[操作] || '✏️'}</span>
            <span class="fc-title">${操作名[操作] || '文件变更'}</span>
            <span class="fc-file">📄 ${文件名}</span>
            <span class="fc-stats">
                <span class="fc-add">+${新增行}</span>
                <span class="fc-del">−${删除行}</span>
                <span class="fc-total">${旧行数}→${新行数}行</span>
            </span>
        </div>
        <div class="fc-flow"></div>
        <div class="fc-diff"></div>
    `;
    messagesEl.appendChild(card);

    // 渲染SVG节点流程
    const flowEl = card.querySelector('.fc-flow');
    const ns = 'http://www.w3.org/2000/svg';
    const nodes = [];
    const conns = [];
    // 节点布局
    let nx = 10, ny = 10;
    const nw = 80, nh = 32, gap = 40;
    // 📄原文件节点
    nodes.push({id: 'f0', label: '📄 原文件', desc: `${旧行数}行`, color: '#4a9eff', x: nx, y: ny});
    nx += nw + gap;
    // 删除行节点（有删除才显示）
    if (删除行 > 0) {
        nodes.push({id: 'f1', label: '❌ 删除', desc: `${删除行}行`, color: '#ff6b6b', x: nx, y: ny});
        conns.push({from: 'f0', to: 'f1'});
        nx += nw + gap;
    }
    // 新增行节点（有新增才显示）
    if (新增行 > 0) {
        const addId = 删除行 > 0 ? 'f2' : 'f1';
        nodes.push({id: addId, label: '➕ 新增', desc: `${新增行}行`, color: '#2ecc71', x: nx, y: ny});
        conns.push({from: 'f0', to: addId});
        nx += nw + gap;
    }
    // 💾结果节点
    const resultId = `f${nodes.length}`;
    nodes.push({id: resultId, label: '💾 完成', desc: `${新行数}行`, color: '#9b59b6', x: nx, y: ny});
    // 连接最后一个操作节点→结果
    if (nodes.length > 1) {
        conns.push({from: nodes[nodes.length - 2].id, to: resultId});
    }
    // 渲染SVG
    const svgW = nodes.length * (nw + gap) + 10;
    let svgHtml = `<svg width="${Math.max(svgW, 200)}" height="${nh + 30}" viewBox="0 0 ${Math.max(svgW, 200)} ${nh + 30}" style="background:#080812;border-radius:6px;">`;
    svgHtml += '<defs><marker id="fcArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#3a4a7a"/></marker></defs>';
    for (const c of conns) {
        const f = nodes.find(n => n.id === c.from), t = nodes.find(n => n.id === c.to);
        if (f && t) {
            const x1 = f.x + nw, y1 = f.y + nh/2, x2 = t.x, y2 = t.y + nh/2;
            svgHtml += `<path d="M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}" stroke="#3a4a7a" stroke-width="2" fill="none" marker-end="url(#fcArrow)"/>`;
        }
    }
    for (const n of nodes) {
        svgHtml += `<rect x="${n.x}" y="${n.y}" width="${nw}" height="${nh}" rx="6" fill="${n.color}22" stroke="${n.color}" stroke-width="1.5"/>`;
        svgHtml += `<text x="${n.x+nw/2}" y="${n.y+14}" text-anchor="middle" font-size="10" fill="${n.color}">${n.label}</text>`;
        svgHtml += `<text x="${n.x+nw/2}" y="${n.y+26}" text-anchor="middle" font-size="9" fill="#8888aa">${n.desc}</text>`;
    }
    svgHtml += '</svg>';
    flowEl.innerHTML = svgHtml;

    // 渲染Diff预览
    const diffEl = card.querySelector('.fc-diff');
    const 旧行 = (d.旧内容 || '').split('\n').filter(l => l !== undefined);
    const 新行 = (d.新内容 || '').split('\n').filter(l => l !== undefined);
    const 旧集 = new Set(旧行);
    const 新集 = new Set(新行);
    const maxLen = Math.max(旧行.length, 新行.length);
    const minLen = Math.min(旧行.length, 新行.length);
    let diffHtml = '';
    let shown = 0;
    const MAX_DIFF_LINES = 40;
    for (let i = 0; i < maxLen && shown < MAX_DIFF_LINES; i++) {
        const oldL = i < 旧行.length ? 旧行[i] : null;
        const newL = i < 新行.length ? 新行[i] : null;
        if (oldL !== null && newL !== null && oldL === newL) {
            diffHtml += `<div class="diff-line diff-ctx"><span class="diff-no">${i+1}</span> ${escapeHtml(oldL)}</div>`;
            shown++;
        } else {
            if (oldL !== null && !新集.has(oldL)) {
                diffHtml += `<div class="diff-line diff-del"><span class="diff-no">-${i+1}</span> ${escapeHtml(oldL)}</div>`;
                shown++;
            }
            if (newL !== null && !旧集.has(newL)) {
                diffHtml += `<div class="diff-line diff-add"><span class="diff-no">+${i+1}</span> ${escapeHtml(newL)}</div>`;
                shown++;
            }
        }
    }
    if (maxLen > MAX_DIFF_LINES) {
        diffHtml += `<div class="diff-more">...共${maxLen}行变更，已显示${shown}行</div>`;
    }
    if (!diffHtml) {
        diffHtml = '<div class="diff-more">无内容变更（空文件或内容相同）</div>';
    }
    diffEl.innerHTML = diffHtml;

    messagesEl.scrollTop = messagesEl.scrollHeight;
    log('系统', `${操作图标[操作] || '✏️'} ${操作名[操作] || '文件变更'}: ${文件名} (+${新增行} −${删除行})`);
}

// ===== 命令执行可视化卡片 =====
function renderCommandCard(工具名, 参数, 结果) {
    const 命令 = 参数.command || 参数.命令 || '';
    const 路径 = 参数.path || 参数.路径 || '';
    const 成功 = 结果 && (结果.startsWith('✅') || 结果.includes('运行成功') || 结果.includes('语法检查通过'));
    const 失败 = 结果 && (结果.startsWith('❌') || 结果.startsWith('⚠️') || 结果.includes('错误') || 结果.includes('失败'));
    const 图标 = 工具名 === 'run_command' ? '💻' : 工具名 === 'run_test' ? '🧪' : 工具名 === 'verify_code' ? '✅' : '⚙️';
    const 标题 = 工具名 === 'run_command' ? '运行命令' : 工具名 === 'run_test' ? '运行测试' : 工具名 === 'verify_code' ? '验证代码' : '系统操作';

    const card = document.createElement('div');
    card.className = 'msg assistant cmd-card';
    card.style.cssText = 'background:#0d0d18;border:1px solid #1a1a2e;border-radius:8px;padding:10px 14px;margin:6px 16px;font-size:13px;';
    let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">`
        + `<span style="font-size:16px;">${图标}</span>`
        + `<span style="color:#4a9eff;font-weight:bold;">${标题}</span>`
        + (成功 ? '<span style="color:#2ecc71;font-size:12px;">✅ 成功</span>' : '')
        + (失败 ? '<span style="color:#ff6b6b;font-size:12px;">❌ 失败</span>' : '')
        + `</div>`;
    if (命令) html += `<div style="background:#000;color:#0f0;padding:4px 8px;border-radius:4px;font-family:monospace;font-size:12px;margin-bottom:4px;overflow-x:auto;">$ ${escapeHtml(命令)}</div>`;
    if (路径) html += `<div style="color:#8888aa;font-size:11px;margin-bottom:4px;">📄 ${escapeHtml(路径.split(/[\\/]/).pop())}</div>`;
    const 结果摘要 = escapeHtml((结果 || '').slice(0, 300));
    html += `<div style="color:${失败 ? '#ff8888' : '#aaaacc'};font-size:12px;padding:4px 8px;background:#101020;border-radius:4px;max-height:150px;overflow-y:auto;white-space:pre-wrap;">${结果摘要}</div>`;
    card.innerHTML = html;
    // 如果ReAct卡片存在，命令卡片插入到ReAct日志区内部；否则作为独立消息
    const reactCard = document.getElementById('react-graph-card');
    const reactLog = reactCard ? reactCard.querySelector('#react-log') : null;
    if (reactLog) {
        card.style.margin = '4px 0';
        reactLog.appendChild(card);
    } else {
        messagesEl.appendChild(card);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    log('系统', `${图标} ${标题}: ${结果.slice(0,60)}`);
}

// ===== 权限询问弹窗 =====
function showPermissionDialog(数据) {
    const 路径 = 数据.路径 || '';
    const 操作 = 数据.操作 || '写';
    const permID = 数据.ID || '';
    const 文件名 = 路径.split(/[\\/]/).pop() || 路径;
    log('系统', `🔒 权限询问: ${操作} ${文件名}`);

    // 移除旧弹窗
    const old = document.getElementById('perm-dialog');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'perm-dialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#101020;border:1px solid #2a2a44;border-radius:12px;padding:24px 28px;max-width:480px;box-shadow:0 12px 48px rgba(0,0,0,0.6);">
            <div style="font-size:16px;font-weight:bold;color:#f39c12;margin-bottom:12px;">🔒 权限请求</div>
            <div style="font-size:13px;color:#c8c8e0;margin-bottom:8px;">AI请求${操作}以下路径：</div>
            <div style="background:#0d0d18;border-radius:6px;padding:8px 12px;font-size:12px;color:#8888aa;font-family:monospace;margin-bottom:16px;word-break:break-all;">${escapeHtml(路径)}</div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button id="perm-forever-btn" style="background:linear-gradient(135deg,#2a5a2a,#1a4a1a);border:none;border-radius:6px;padding:8px 20px;color:#e0ffe0;font-size:13px;cursor:pointer;font-family:inherit;">✅ 永久授权</button>
                <button id="perm-once-btn" style="background:linear-gradient(135deg,#2a4a8a,#1a3a7a);border:none;border-radius:6px;padding:8px 20px;color:#e0e8ff;font-size:13px;cursor:pointer;font-family:inherit;">允许一次</button>
                <button id="perm-deny-btn" style="background:#3a1a1a;border:1px solid #5a2a2a;border-radius:6px;padding:8px 20px;color:#ffe0e0;font-size:13px;cursor:pointer;font-family:inherit;">❌ 拒绝</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    function respond(操作) {
        fetch(API_BASE + '/api/permission-response', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({操作: 操作, ID: permID})
        }).catch(() => {});
        overlay.remove();
    }
    document.getElementById('perm-forever-btn').addEventListener('click', () => respond('永久'));
    document.getElementById('perm-once-btn').addEventListener('click', () => respond('一次'));
    document.getElementById('perm-deny-btn').addEventListener('click', () => respond('拒绝'));
}

// ===== 工具解锁弹窗 =====
function showToolUnlockDialog(数据) {
    const 工具名 = 数据.工具名 || '';
    const 中文名 = 数据.中文名 || 工具名;
    const 图标 = 数据.图标 || '🔧';
    const 描述 = 数据.描述 || '';
    const unlockID = 数据.ID || '';
    log('系统', `🔒 工具解锁请求: ${中文名} (${工具名})`);

    const old = document.getElementById('tool-unlock-dialog');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'tool-unlock-dialog';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#101020;border:1px solid #2a2a44;border-radius:12px;padding:24px 28px;max-width:440px;box-shadow:0 12px 48px rgba(0,0,0,0.6);">
            <div style="font-size:16px;font-weight:bold;color:#f39c12;margin-bottom:12px;">🔒 工具解锁</div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <span style="font-size:28px;">${图标}</span>
                <div>
                    <div style="font-size:15px;color:#c8c8e0;font-weight:bold;">${escapeHtml(中文名)}</div>
                    <div style="font-size:11px;color:#6666aa;font-family:monospace;">${escapeHtml(工具名)}</div>
                </div>
            </div>
            <div style="font-size:12px;color:#8888aa;margin-bottom:16px;line-height:1.6;">${escapeHtml(描述)}</div>
            <div style="font-size:11px;color:#555577;margin-bottom:16px;">AI请求使用此工具，是否允许？永久授权后后续不再询问。</div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button id="tool-unlock-yes" style="background:linear-gradient(135deg,#2a5a2a,#1a4a1a);border:none;border-radius:6px;padding:8px 20px;color:#e0ffe0;font-size:13px;cursor:pointer;font-family:inherit;">✅ 永久授权</button>
                <button id="tool-unlock-once" style="background:linear-gradient(135deg,#2a4a8a,#1a3a7a);border:none;border-radius:6px;padding:8px 20px;color:#e0e8ff;font-size:13px;cursor:pointer;font-family:inherit;">允许一次</button>
                <button id="tool-unlock-no" style="background:#3a1a1a;border:1px solid #5a2a2a;border-radius:6px;padding:8px 20px;color:#ffe0e0;font-size:13px;cursor:pointer;font-family:inherit;">❌ 拒绝</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    function respond(操作) {
        if (操作 === '永久') {
            fetch(API_BASE + '/api/tool-unlock', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({名称: 工具名, 操作: '永久'})
            }).catch(() => {});
        }
        // 权限询问容器复用——永久和一次都设确认
        fetch(API_BASE + '/api/permission-response', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({操作: 操作 === '拒绝' ? '拒绝' : 操作, ID: unlockID})
        }).catch(() => {});
        overlay.remove();
    }
    document.getElementById('tool-unlock-yes').addEventListener('click', () => respond('永久'));
    document.getElementById('tool-unlock-once').addEventListener('click', () => respond('一次'));
    document.getElementById('tool-unlock-no').addEventListener('click', () => respond('拒绝'));
}

function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ReAct实时节点图渲染——自动换行布局
function renderReactSVG() {
    if (!reactGraph) return;
    const container = document.getElementById('react-svg-container');
    if (!container) return;
    const ns = 'http://www.w3.org/2000/svg';
    const nodeW = 100, nodeH = 36, gapX = 28, gapY = 24;
    const containerW = container.clientWidth || 400;
    const nodesPerRow = Math.max(3, Math.floor((containerW - 10) / (nodeW + gapX)));
    const totalNodes = reactGraph.nodes.length;
    // 标准布局：每行从左到右
    reactGraph.nodes.forEach((n, i) => {
        const row = Math.floor(i / nodesPerRow);
        const col = i % nodesPerRow;
        n.x = 5 + col * (nodeW + gapX);
        n.y = 5 + row * (nodeH + gapY);
    });
    const rows = Math.ceil(totalNodes / nodesPerRow);
    const svgW = Math.max(containerW, nodesPerRow * (nodeW + gapX) + 10);
    const svgH = Math.max(60, rows * (nodeH + gapY) + 5);
    let svg = `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="background:transparent;">`;
    // defs: 渐变+动画marker
    svg += '<defs>';
    svg += '<marker id="reactArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#4a6a9a"/></marker>';
    svg += '<marker id="reactArrowActive" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#6a8aba"/></marker>';
    svg += '<filter id="nodeGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    svg += '</defs>';
    // 连线——蛇形布局下同行贝塞尔，换行短弧
    for (let i = 0; i < reactGraph.conns.length; i++) {
        const c = reactGraph.conns[i];
        const from = reactGraph.nodes.find(n => n.id === c.from);
        const to = reactGraph.nodes.find(n => n.id === c.to);
        if (from && to) {
            const isLast = (i === reactGraph.conns.length - 1);
            const strokeColor = isLast ? '#6a8aba' : '#2a3a5a';
            const strokeWidth = isLast ? 2 : 1.2;
            const markerId = isLast ? 'reactArrowActive' : 'reactArrow';
            const dashAnim = isLast ? 'stroke-dasharray="4 2"' : '';
            const sameRow = Math.abs(from.y - to.y) < 5;
            // 判断方向：标准布局下同行都是左→右
            const fromRight = from.x < to.x;  // from在左边→从右侧出
            if (sameRow) {
                const x1 = fromRight ? from.x + nodeW : from.x;
                const y1 = from.y + nodeH/2;
                const x2 = fromRight ? to.x : to.x + nodeW;
                const y2 = to.y + nodeH/2;
                const midX = (x1 + x2) / 2;
                svg += `<path d="M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" ${dashAnim} marker-end="url(#${markerId})" ${isLast ? 'class="react-flow-line"' : ''}/>`;
            }
            // 换行时不画连线——避免竖排连线混乱
        }
    }
    // 节点
    for (let i = 0; i < reactGraph.nodes.length; i++) {
        const n = reactGraph.nodes[i];
        const isLast = (i === reactGraph.nodes.length - 1);
        const x = n.x, y = n.y;
        const opacity = isLast ? 1 : Math.max(0.35, 1 - (totalNodes - 1 - i) * 0.08);
        const filter = isLast ? 'filter="url(#nodeGlow)"' : '';
        // 背景
        svg += `<g class="react-node ${isLast ? 'react-node-active' : ''}" style="opacity:${opacity}">`;
        svg += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="8" fill="${n.color}12" stroke="${n.color}" stroke-width="${isLast ? 1.8 : 1}" ${filter}/>`;
        // 左侧色条
        svg += `<rect x="${x}" y="${y}" width="3" height="${nodeH}" rx="1.5" fill="${n.color}"/>`;
        // 图标
        svg += `<text x="${x+12}" y="${y+23}" font-size="13">${n.icon}</text>`;
        // 标签
        const label = n.label.length > 12 ? n.label.substring(0, 11) + '…' : n.label;
        svg += `<text x="${x+24}" y="${y+19}" font-size="10" fill="#c8c8e0" font-family="'Microsoft YaHei',sans-serif">${label}</text>`;
        // 步骤序号
        svg += `<text x="${x+24}" y="${y+31}" font-size="8" fill="#666688">#${i+1}</text>`;
        svg += '</g>';
    }
    svg += '</svg>';
    container.innerHTML = svg;
    container.style.overflowX = 'hidden';
    container.style.overflowY = 'auto';
    container.style.maxHeight = '200px';
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (isFinite(reactGraph.nodes.length) && reactGraph.nodes.length > 0) {
        const last = reactGraph.nodes[reactGraph.nodes.length - 1];
        const prev = reactGraph.nodes[reactGraph.nodes.length - 2];
        if (prev && last) {
            sendSignal(prev.label, last.label, null);
            activateNeuron(last.label, last.label.slice(0, 40));
        }
    }
}

async function processEvent(data) {
if (data._输出回调) {
    await waitForParticle('表达', 'output');
    播放传输音(false);  // 输出：高音
    data._输出回调();
        const msgs = messagesEl.querySelectorAll('.msg.assistant');
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg) {
            lastMsg.classList.remove('msg-highlight');
            void lastMsg.offsetWidth;
            lastMsg.classList.add('msg-highlight');
        }
        await delay(50);
        return;
    }
    if (data._是完成) {
        // 移除流式光标——无论'输出'事件是否正常处理，'完成'时必须清除光标
        const cursors = document.querySelectorAll('.stream-cursor');
        cursors.forEach(c => c.remove());
        // 如果有最终回复但'输出'事件未触发（如强制最终回复），用回复内容渲染
        if (data._回复) {
            const msgs = messagesEl.querySelectorAll('.msg.assistant');
            const lastMsg = msgs[msgs.length - 1];
            // 只在最后一条消息为空或不存在时才渲染（避免与输出事件重复）
            if (lastMsg && (!lastMsg.innerHTML.trim() || lastMsg.innerHTML.trim() === '<br>')) {
                lastMsg.innerHTML = renderMarkdown(data._回复);
                enhanceCodeBlocks(lastMsg);
                messagesEl.scrollTop = messagesEl.scrollHeight;
            } else if (!lastMsg) {
                // 没有任何assistant消息——创建一条
                addMessage('assistant', data._回复);
            }
        }
        // 显示Token统计
        if (data._统计) {
            const s = data._统计;
            const 总秒 = s.总耗时毫秒 ? (s.总耗时毫秒 / 1000).toFixed(1) + 's' : '';
            const totalTk = s.total_tokens ? (s.total_tokens > 1000 ? (s.total_tokens/1000).toFixed(1)+'k' : s.total_tokens) : '';
            const 费用 = s.费用 ? '¥' + s.费用.toFixed(4) : '';
            log('系统', '⚡' + (s.步数||0) + '步 ⏱' + 总秒 + (totalTk ? ' 🔤' + totalTk : '') + (费用 ? ' 💰' + 费用 : ''));
            const statsDiv = document.createElement('div');
            statsDiv.className = 'token-stats';
            const summaryLine = '<span>⚡ ' + (s.步数 || 0) + '步</span>'
                + (总秒 ? '<span>⏱ ' + 总秒 + '</span>' : '')
                + (totalTk ? '<span>🔤 ' + totalTk + '</span>' : '')
                + (费用 ? '<span>💰 ' + 费用 + '</span>' : '');
            statsDiv.innerHTML = summaryLine;

            messagesEl.appendChild(statsDiv);
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        if (data._总结 && data._总结.值得记忆 && data._总结.标题) {
            showSummaryModal(data._总结, () => {});
        }
        return;
    }
    switch (data.类型) {
        case '路线图开始': {
            路线图模式 = true;
            // 路线图执行时显示浮空粒子面板
            if (typeof showFloatCanvas === 'function') showFloatCanvas();
            // 更新卡片状态：执行中
            if (当前路线图卡片) {
                当前路线图卡片.execBtn.textContent = '⏳ 执行中...';
                当前路线图卡片.状态标签.textContent = '⏳ 执行中';
                当前路线图卡片.状态标签.style.color = '#f39c12';
                当前路线图卡片.cancelBtn.disabled = true;
            }
            resetDisplay();  // 只清画布，不清事件队列（避免丢失后续事件）
            const rm = data.数据;
            const rmNodes = rm.节点 || [];
            const rmConns = rm.连接 || [];
            // 添加规划师节点
            neurons.push(makeNeuron('规划师', '📋', '思考'));
            // 添加路线图节点
            rmNodes.forEach(n => {
                const name = n.名称 || n.id;
                if (name && !neurons.find(nn => nn.名称 === name)) {
                    const 层 = n.类型 === '角色' ? '角色' : '思考';
                    neurons.push(makeNeuron(name, n.图标 || '🔹', 层));
                }
            });
            // 三层布局：规划师(底) → 角色(中) → 汇总(顶)
            const cy = canvasH / 2;
            const pNeuron = neurons.find(n => n.名称 === '规划师');
            if (pNeuron) { pNeuron.x = canvasW / 2; pNeuron.y = cy + 80; pNeuron.目标透明度 = 1.0; }
            const roleNs = rmNodes.filter(n => n.类型 === '角色');
            roleNs.forEach((n, i) => {
                const name = n.名称 || n.id;
                const neuron = neurons.find(nn => nn.名称 === name);
                if (neuron) {
                    const spread = (roleNs.length - 1) * 130;
                    neuron.x = canvasW / 2 - spread / 2 + i * 130;
                    neuron.y = cy;
                    neuron.目标透明度 = 1.0;
                    synapses.push({源: '规划师', 目标: name, 权重: 0.8});
                }
            });
            const sumNs = rmNodes.filter(n => n.类型 !== '角色');
            sumNs.forEach((n, i) => {
                const name = n.名称 || n.id;
                const neuron = neurons.find(nn => nn.名称 === name);
                if (neuron) {
                    const spread = Math.max(0, (sumNs.length - 1) * 130);
                    neuron.x = canvasW / 2 - spread / 2 + i * 130;
                    neuron.y = cy - 80;
                    neuron.目标透明度 = 1.0;
                }
            });
            // 预连线
            rmConns.forEach(c => {
                const fromNode = rmNodes.find(n => n.id === c.from);
                const toNode = rmNodes.find(n => n.id === c.to);
                const from = fromNode ? (fromNode.名称 || fromNode.id) : (c.from === '起点' ? '规划师' : c.from);
                const to = toNode ? (toNode.名称 || toNode.id) : c.to;
                if (from && to && from !== to && !synapses.find(s => s.源 === from && s.目标 === to)) {
                    synapses.push({源: from, 目标: to, 权重: 0.8});
                }
            });
            显示横幅('📋 路线图执行中', '#4a9eff');
            log('系统', '📋 路线图执行开始');
            await delay(300);
            break;
        }
        case '路线图结束':
            路线图模式 = false;
            隐藏横幅();
            // 更新卡片状态：已完成
            if (当前路线图卡片) {
                当前路线图卡片.execBtn.disabled = false;
                当前路线图卡片.execBtn.textContent = '🔄 再次执行';
                当前路线图卡片.execBtn.style.opacity = '1';
                当前路线图卡片.状态标签.textContent = '✅ 已完成';
                当前路线图卡片.状态标签.style.color = '#2ecc71';
                当前路线图卡片.cancelBtn.disabled = false;
                当前路线图卡片 = null;
            }
            log('系统', '✅ 路线图执行完成');
            if (window.playSound) playSound('roadmap-done');
            // 延迟1.5秒再淡出，让用户看清节点布局
            await delay(1500);
            neurons.forEach(n => { n.目标透明度 = 0; n.生命周期 = 0; });
            break;
        case 'react': {
            const rd = data.数据;
            if (rd.阶段 === '开始') {
                // 清除上一次的ReAct卡片（如果残留）
                const oldCard = document.getElementById('react-graph-card');
                if (oldCard) oldCard.remove();
                // 创建ReAct节点图卡片
                reactGraph = {nodes: [], conns: [], nextX: 20, nextY: 15, stepCount: 0, toolCount: 0};
                const card = document.createElement('div');
                card.className = 'msg assistant';
                card.id = 'react-graph-card';
                card.style.cssText = 'border:1px solid #4a6aaa;background:linear-gradient(135deg,#0a0a18,#0f0f24);padding:12px;margin-bottom:10px;border-radius:12px;overflow:hidden;';
                card.innerHTML = `
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span style="font-size:14px;">🔄</span>
                        <span style="color:#4a9eff;font-size:13px;font-weight:600;">ReAct推理过程</span>
                        <span id="react-step-count" style="font-size:10px;color:#666688;margin-left:auto;">0步</span>
                    </div>
                    <div id="react-progress-bar" style="height:3px;background:#1a1a2e;border-radius:2px;overflow:hidden;margin-bottom:8px;">
                        <div id="react-progress-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#4a9eff,#6a8aba);border-radius:2px;transition:width 0.3s ease;"></div>
                    </div>
                    <div id="react-svg-container" style="overflow-x:auto;overflow-y:hidden;max-height:80px;"></div>
                    <div id="react-log" style="font-size:11px;color:#8888aa;margin-top:6px;max-height:100px;overflow-y:auto;"></div>
                `;
                messagesEl.appendChild(card);
                messagesEl.scrollTop = messagesEl.scrollHeight;
                log('系统', '🔄 ReAct推理开始');
            } else if (rd.阶段 === '结束') {
                // 标记完成
                const card = document.getElementById('react-graph-card');
                if (card) {
                    const fill = card.querySelector('#react-progress-fill');
                    if (fill) fill.style.width = '100%';
                    const log2 = card.querySelector('#react-log');
                    if (log2) {
                        const total = reactGraph ? reactGraph.stepCount : 0;
                        const tools = reactGraph ? reactGraph.toolCount : 0;
                        log2.innerHTML += `<div style="color:#2ecc71;padding-top:4px;border-top:1px solid #1a1a2e;margin-top:4px;">✅ ReAct推理完成 · ${total}步 · ${tools}次工具调用</div>`;
                    }
                }
                reactGraph = null;
                log('系统', '✅ ReAct推理完成');
            } else {
                // 添加节点
                if (!reactGraph) break;
                const icons = {思考:'🧠', 工具:'🔧', 观察:'📥', 输出:'🗣️', 交代:'💬'};
                const colors = {思考:'#4a9eff', 工具:'#e67e22', 观察:'#2ecc71', 输出:'#9b59b6', 交代:'#aaaacc'};
                const icon = icons[rd.阶段] || '⚪';
                const color = colors[rd.阶段] || '#666';
                const label = rd.阶段 === '工具' ? `${icon} ${rd.工具名 || '工具'}` : `${icon} ${rd.阶段}`;
                const node = {id: rd.节点id, label, icon, color, x: reactGraph.nextX, y: reactGraph.nextY, 阶段: rd.阶段};
                reactGraph.nodes.push(node);
                reactGraph.stepCount++;
                if (rd.阶段 === '工具') reactGraph.toolCount++;
                if (rd.上一节点) {
                    reactGraph.conns.push({from: rd.上一节点, to: rd.节点id});
                }
                // 横向排列，超过10个节点自动换行
                if (reactGraph.nodes.length % 8 === 0) {
                    reactGraph.nextX = 20;
                    reactGraph.nextY += 55;
                } else {
                    reactGraph.nextX += 134;
                }
                // 进度条
                const card = document.getElementById('react-graph-card');
                if (card) {
                    const stepEl = card.querySelector('#react-step-count');
                    if (stepEl) stepEl.textContent = `${reactGraph.stepCount}步`;
                    const fill = card.querySelector('#react-progress-fill');
                    if (fill) {
                        const pct = Math.min(90, reactGraph.stepCount * 12);
                        fill.style.width = pct + '%';
                    }
                    // 日志（带颜色标签+折叠内容）
                    const logEl = card.querySelector('#react-log');
                    if (logEl) {
                        const text = rd.内容 || rd.工具名 || '';
                        const textDisplay = text.length > 80 ? text.slice(0, 80) + '…' : text;
                        const logLine = document.createElement('div');
                        logLine.style.cssText = 'padding:2px 0;display:flex;gap:4px;align-items:baseline;';
                        logLine.innerHTML = `<span style="color:${color};font-weight:600;flex-shrink:0;">${label}</span><span style="color:#555577;font-size:10px;">${textDisplay}</span>`;
                        logEl.appendChild(logLine);
                        logEl.scrollTop = logEl.scrollHeight;
                    }
                }
                // 重新渲染SVG
                renderReactSVG();
            }
            break;
        }
        case 'file_change': {
            renderFileChangeCard(data.数据);
            break;
        }
        case '节点开始': {
            // 节点开始执行——高亮对应神经元
            const nd = data.数据;
            const nName = nd.name || nd.id;
            const neuron = neurons.find(nn => nn.名称 === nName);
            if (neuron) {
                neuron.激活度 = 1.0;
                neuron.脉冲.push({r: 0, life: 1.0});
            }
            log('系统', `⏳ ${nd.icon||''} ${nName} 执行中`);
            break;
        }
        case '节点完成': {
            // 节点执行完成——脉冲+日志
            const nd = data.数据;
            const nName = nd.name || nd.id;
            const neuron = neurons.find(nn => nn.名称 === nName);
            if (neuron) {
                neuron.激活度 = 1.0;
                neuron.脉冲.push({r: 0, life: 1.0});
                neuron.思考气泡 = nd.成功 ? `✅ ${nd.输出?.slice(0,80)||''}` : `❌ ${nd.输出?.slice(0,80)||''}`;
            }
            log('系统', `${nd.成功?'✅':'❌'} ${nd.icon||''} ${nName} ${nd.成功?'完成':'失败'}`);
            break;
        }
        case '节点ReAct': {
            // 路线图节点内ReAct循环——在对话区显示执行过程
            const rd = data.数据;
            const 节点名 = rd.节点 || '节点';
            const 轮次 = rd.轮次 || 1;
            const 阶段 = rd.阶段 || '';
            if (阶段 === '工具') {
                const 工具名 = rd.工具名 || '';
                const 参数 = rd.参数 || '';
                log('系统', `  └ 🔧 [${节点名}] 轮次${轮次} 工具: ${工具名}(${参数})`);
                // 在对话区追加执行卡片
                const div = document.createElement('div');
                div.className = 'msg assistant';
                div.style.cssText = 'font-size:12px;color:#8888aa;padding:4px 8px;margin:2px 0;border-left:2px solid #e67e22;';
                div.innerHTML = `<span style="color:#e67e22;">🔧 [${节点名}]</span> ${工具名}(${参数})`;
                messagesEl.appendChild(div);
                messagesEl.scrollTop = messagesEl.scrollHeight;
            } else if (阶段 === '观察') {
                const 结果 = (rd.结果 || '').slice(0, 150);
                log('系统', `  └ 📥 [${节点名}] 轮次${轮次} 结果: ${结果}`);
                const div = document.createElement('div');
                div.className = 'msg assistant';
                div.style.cssText = 'font-size:12px;color:#666688;padding:4px 8px;margin:2px 0;border-left:2px solid #2ecc71;';
                div.innerHTML = `<span style="color:#2ecc71;">📥 [${节点名}]</span> ${结果}`;
                messagesEl.appendChild(div);
                messagesEl.scrollTop = messagesEl.scrollHeight;
            } else if (阶段 === '输出') {
                const 内容 = (rd.内容 || '').slice(0, 200);
                log('系统', `  └ 🗣️ [${节点名}] 最终输出: ${内容}`);
                const div = document.createElement('div');
                div.className = 'msg assistant';
                div.style.cssText = 'font-size:12px;color:#9b59b6;padding:4px 8px;margin:2px 0;border-left:2px solid #9b59b6;';
                div.innerHTML = `<span style="color:#9b59b6;">🗣️ [${节点名}]</span> ${内容}`;
                messagesEl.appendChild(div);
                messagesEl.scrollTop = messagesEl.scrollHeight;
            } else if (阶段 === '错误') {
                const 内容 = rd.内容 || '';
                log('系统', `  └ ❌ [${节点名}] 错误: ${内容}`);
                const div = document.createElement('div');
                div.className = 'msg assistant';
                div.style.cssText = 'font-size:12px;color:#f44336;padding:4px 8px;margin:2px 0;border-left:2px solid #f44336;';
                div.innerHTML = `<span style="color:#f44336;">❌ [${节点名}]</span> ${内容}`;
                messagesEl.appendChild(div);
                messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            break;
        }
        case '进度': {
            const p = data.数据;
            if (当前路线图卡片) {
                当前路线图卡片.状态标签.textContent = `⏳ ${p.已完成}/${p.总数}`;
                当前路线图卡片.状态标签.style.color = '#f39c12';
            }
            break;
        }
        case '角色协作开始':
            resetDisplay();
            显示横幅('🎭 角色协作中', '#9b59b6');
            log('系统', '🎭 角色协作开始: ' + (data.数据.角色 || []).join(', '));
            await delay(200);
            break;
        case '角色协作结束':
            隐藏横幅();
            log('系统', '✅ 角色协作完成');
            await delay(100);
            break;
        case '注入':
            log('注入', `用户输入: "${data.数据.内容}"`);
            预定位('听觉');
            await waitForParticle('input', '听觉');
            显示神经元('听觉');
            await delay(50);
            break;
        case '传播':
            if (data.数据.从 && data.数据.到) {
                log('传播', `${data.数据.从} → ${data.数据.到} [${data.数据.信号类型}] "${data.数据.内容摘要}"`);
                // 角色节点动态加入
                if (!neurons.find(n => n.名称 === data.数据.到)) {
                    neurons.push(makeNeuron(data.数据.到, '🎭', '角色'));
                }
                预定位(data.数据.到);
                // 角色层并行传播——不等粒子，直接发射
                if (neurons.find(n => n.名称 === data.数据.到 && n.层 === '角色')) {
                    sendSignal(data.数据.从, data.数据.到, () => {});
                    显示神经元(data.数据.到);
                    const exists = synapses.find(s => s.源 === data.数据.从 && s.目标 === data.数据.到);
                    if (!exists) synapses.push({ 源: data.数据.从, 目标: data.数据.到, 权重: 0.5 });
                    break;
                }
                await waitForParticle(data.数据.从, data.数据.到);
                显示神经元(data.数据.到);
                const exists2 = synapses.find(s => s.源 === data.数据.从 && s.目标 === data.数据.到);
                if (!exists2) {
                    synapses.push({ 源: data.数据.从, 目标: data.数据.到, 权重: 0.5 });
                }
                await delay(50);
            }
            break;
        case '激活':
            log('激活', `${data.数据.图标} ${data.数据.ID} 激活度:${data.数据.激活度.toFixed(2)}`, data.数据.思考);
            显示神经元(data.数据.ID);
            activateNeuron(data.数据.ID, data.数据.思考);
            await delay(100);
            break;
        case '错误':
            log('错误', `${data.数据.ID}: ${data.数据.错误}`);
            console.error(data.数据.堆栈 || data.数据.错误);
            break;
        case '输出':
            if (data.数据.角色) {
                // 角色输出——显示为角色消息
                log('输出', `🎭 ${data.数据.ID}: "${data.数据.内容.slice(0,60)}"`);
                const roleMsg = addMessage('assistant', '');
                roleMsg.innerHTML = `<strong style="color:#9b59b6">🎭 ${data.数据.ID}</strong><br>` + renderMarkdown(data.数据.内容); enhanceCodeBlocks(roleMsg);
                roleMsg.classList.add('msg-highlight');
                messagesEl.scrollTop = messagesEl.scrollHeight;
                播放音效(data.数据.ID);
            } else {
                log('输出', `表达 → 对话区: "${data.数据.内容}"`);
            }
            break;
    }
}

async function processQueue() {
    if (processingEvent) return; processingEvent = true;
    try {
        while (eventQueue.length > 0) { const data = eventQueue.shift(); await processEvent(data); }
    } catch(e) {
        console.error('[neuron] processQueue error:', e);
    } finally {
        processingEvent = false;
    }
}

// ===== 系统操作——通过对话触发界面操作 =====
function _执行系统操作(操作) {
    if (操作 === '打开工作流') {
        // 嵌入主系统时调用empWidget打开节点工作流
        if (typeof window.empWidget !== 'undefined' && window.empWidget.openWorkflow) {
            window.empWidget.openWorkflow();
            log('系统', '🔀 已打开节点工作流');
        } else if (typeof openWorkflow === 'function') {
            openWorkflow();
            log('系统', '🔀 已打开节点工作流');
        } else if (typeof toggleWorkflow === 'function') {
            toggleWorkflow();
            log('系统', '🔀 已打开节点工作流');
        } else {
            log('系统', '⚠️ 节点工作流未加载');
        }
    } else if (操作 === '查看定时任务') {
        _列出定时任务();
    } else if (操作 === '打开定时任务') {
        _打开定时任务面板();
    } else if (操作 === '创建定时任务') {
        _打开定时任务面板();
        log('系统', '📅 请在日历中选择日期和时间创建任务');
    } else if (操作 === '删除定时任务') {
        _管理定时任务('删除');
    } else if (操作 === '启用定时任务' || 操作 === '停止定时任务') {
        _管理定时任务(操作 === '启用定时任务' ? '启用' : '停用');
    } else if (操作 === '修改定时任务') {
        _打开定时任务面板();
        log('系统', '✏️ 请在面板中点击任务旁边的✏️按钮修改');
    }
}

// 打开定时任务面板
// 在对话中列出定时任务
async function _列出定时任务() {
    try {
        const resp = await fetch('/api/wf-tasks', { method: 'GET' });
        const data = await resp.json();
        const tasks = data.任务列表 || [];
        if (tasks.length === 0) {
            const msg = addMessage('assistant', '');
            msg.innerHTML = renderMarkdown('📅 **定时任务列表**\n\n暂无定时任务。');
            enhanceCodeBlocks(msg);
            msg.classList.add('msg-highlight');
            log('系统', '📅 暂无定时任务');
            return;
        }
        let md = '📅 **定时任务列表**（共' + tasks.length + '个）\n\n';
        md += '| # | 名称 | 类型 | 时间 | 状态 | 下次执行 |\n';
        md += '|---|------|------|------|------|----------|\n';
        tasks.forEach(function(t, i) {
            var 状态 = t.启用 ? '✅启用' : '⏸️停用';
            var 类型label = {'每日':'📅每日','每周':'📅每周','间隔':'⏱️间隔','每月':'📅每月','仅一次':'📌仅一次'}[t.类型] || t.类型;
            var 详情 = '';
            if (t.日期) { 详情 = t.日期 + ' ' + (t.时间 || '09:00'); }
            else if (t.类型 === '每日') 详情 = '每天 ' + (t.时间 || '09:00');
            else if (t.类型 === '每周') { var days = ['日','一','二','三','四','五','六']; var ds = (t.星期||[]).map(function(d){return days[d-1]||d}); 详情 = '周' + ds.join(',') + ' ' + (t.时间||''); }
            else if (t.类型 === '间隔') 详情 = '每隔' + (t.间隔分钟||30) + '分钟';
            else if (t.类型 === '每月') 详情 = '每月 ' + (t.时间 || '09:00');
            else if (t.类型 === '仅一次') 详情 = t.时间 || '';
            var 下次 = t.下次执行 ? t.下次执行.substring(5) : '-';
            md += '| ' + (i+1) + ' | ' + (t.名称||'未命名') + ' | ' + 类型label + ' | ' + 详情 + ' | ' + 状态 + ' | ' + 下次 + ' |\n';
        });
        const msg = addMessage('assistant', '');
        msg.innerHTML = renderMarkdown(md);
        enhanceCodeBlocks(msg);
        msg.classList.add('msg-highlight');
        messagesEl.scrollTop = messagesEl.scrollHeight;
        log('系统', '📅 列出了' + tasks.length + '个定时任务');
    } catch(e) {
        log('系统', '⚠️ 获取任务列表失败: ' + e.message);
    }
}

function _打开定时任务面板() {
    if (typeof window.empWidget !== 'undefined' && window.empWidget._showTaskPanel) {
        window.empWidget._showTaskPanel();
        log('系统', '📅 已打开计划任务面板');
    } else {
        log('系统', '⚠️ 计划任务功能未加载，请先打开节点工作流');
    }
}

// 管理定时任务（删除/启用/停用）
async function _管理定时任务(操作类型) {
    try {
        const resp = await fetch('/api/wf-tasks', { method: 'GET' });
        const data = await resp.json();
        const tasks = data.任务列表 || [];
        if (tasks.length === 0) {
            log('系统', '📅 暂无定时任务');
            return;
        }
        // 如果只有一个任务，直接操作
        if (tasks.length === 1) {
            await _执行任务操作(tasks[0], 操作类型);
            return;
        }
        // 多个任务：打开面板让用户选择
        _打开定时任务面板();
        log('系统', `📅 有${tasks.length}个定时任务，请在面板中选择操作`);
    } catch(e) {
        log('系统', '⚠️ 获取任务列表失败');
    }
}

async function _执行任务操作(task, 操作类型) {
    const tid = task.id;
    if (操作类型 === '删除') {
        if (confirm(`确认删除定时任务「${task.名称}」？`)) {
            await fetch('/api/wf-tasks', {
                method: 'DELETE', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({id: tid})
            });
            log('系统', `🗑️ 已删除定时任务: ${task.名称}`);
        }
    } else if (操作类型 === '启用') {
        await fetch('/api/wf-tasks', {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id: tid, 更新: {启用: true}})
        });
        log('系统', `✅ 已启用定时任务: ${task.名称}`);
    } else if (操作类型 === '停用') {
        await fetch('/api/wf-tasks', {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id: tid, 更新: {启用: false}})
        });
        log('系统', `⏸️ 已停用定时任务: ${task.名称}`);
    }
}

async function sendMessage() {
    const text = inputBox.value.trim(); if (!text || isSending) return;
    _lastUserMessage = text;  // 保存原始消息，供选项点击时恢复上下文
    isSending = true; sendBtn.disabled = false; sendBtn.textContent = '⏹ 停止'; inputBox.value = '';
    // 清除上次的状态指示器
    const oldStatus = document.getElementById('ai-status-indicator');
    if (oldStatus) oldStatus.remove();
    abortController = new AbortController();
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    播放传输音(true);  // 点击发送即播放输入音
    if (window.playSound) playSound('send');
    resetNeurons();
    showFloatCanvas();  // 显示浮空粒子面板

    // 通过编辑器API收集上下文（主系统嵌入时可用，独立运行时返回空对象）
    const 上下文 = (window.editorAPI ? window.editorAPI.getContext() : {});
    let 发送消息 = text;
    if (上下文.框选文本) {
        const sel = 上下文.框选文本;
        发送消息 = `[用户在文件「${sel.所在文件名}」中选中了以下文本]\n---\n${sel.内容}\n---\n文件路径: ${sel.所在文件}\n\n用户指令: ${text}`;
    } else {
        let 环境摘要 = '';
        if (上下文.当前文件夹) 环境摘要 += `📂 工作目录: ${上下文.当前文件夹}\n`;
        if (上下文.当前文件) 环境摘要 += `✏️ 当前编辑: ${上下文.当前文件.名称} (${上下文.当前文件.路径})\n`;
        if (上下文.打开的文件列表) 环境摘要 += `📄 打开文件: ${上下文.打开的文件列表.map(f => f.名称).join(", ")}\n`;
        if (上下文.选中文件) 环境摘要 += `📋 已选中${上下文.选中文件.length}个文件: ${上下文.选中文件.map(i => i.名称).join(", ")}\n`;
        if (环境摘要) 发送消息 = 环境摘要 + `用户: ${text}`;
    }

    const userMsg = addMessage('user', text);
    userMsg.classList.add('msg-highlight');
    let assistantMsg = null;
    let 流式缓冲 = '';  // 收集流式片段，等粒子到达表达后再显示
    let 待处理文件变更 = [];  // 批量收集file_change事件，对话完成后统一处理
    try {
        const resp = await fetch(API_BASE + '/api/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({消息:发送消息, 上下文, 对话ID:当前对话ID}), signal: abortController.signal });
        const reader = resp.body.getReader(), decoder = new TextDecoder(); let buffer = '';
        while (true) {
            const {done, value} = await reader.read(); if (done) break;
            buffer += decoder.decode(value, {stream:true}); const events = buffer.split('\n\n'); buffer = events.pop();
            for (const event of events) {
                if (!event.startsWith('data: ')) continue; const data = JSON.parse(event.slice(6));
                if (data.类型 === '思考中') {
                    // LLM开始响应——显示临时状态指示器，不覆盖已有消息
                    let statusEl = document.getElementById('ai-status-indicator');
                    if (!statusEl) {
                        statusEl = document.createElement('div');
                        statusEl.id = 'ai-status-indicator';
                        statusEl.style.cssText = 'padding:4px 16px;font-size:12px;color:#6666aa;font-style:italic;';
                        messagesEl.appendChild(statusEl);
                    }
                    statusEl.textContent = '🧠 思考中...';
                    statusEl.style.display = 'block';
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                } else if (data.类型 === '工具调用中') {
                    // LLM正在生成工具调用——更新状态指示器
                    let statusEl = document.getElementById('ai-status-indicator');
                    if (!statusEl) {
                        statusEl = document.createElement('div');
                        statusEl.id = 'ai-status-indicator';
                        statusEl.style.cssText = 'padding:4px 16px;font-size:12px;color:#6666aa;font-style:italic;';
                        messagesEl.appendChild(statusEl);
                    }
                    const 工具名 = data.数据.工具名 || '';
                    statusEl.textContent = '🔧 调用工具: ' + 工具名 + '...';
                    statusEl.style.display = 'block';
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                } else if (data.类型 === '流式回复') {
                    // 流式片段：有内容时隐藏状态指示器，开始渲染消息
                    let statusEl = document.getElementById('ai-status-indicator');
                    if (statusEl) statusEl.style.display = 'none';
                    流式缓冲 += data.数据.内容;
                    if (!动画启用) {
                        if (!assistantMsg) {
                            assistantMsg = addMessage('assistant', '');
                        }
                        // 如果ReAct卡片存在且在assistantMsg后面，把assistantMsg移到ReAct卡片之后
                        const reactCard = document.getElementById('react-graph-card');
                        if (reactCard && reactCard.nextElementSibling !== assistantMsg) {
                            reactCard.insertAdjacentElement('afterend', assistantMsg);
                        }
                        assistantMsg.innerHTML = renderMarkdown(流式缓冲) + '<span class="stream-cursor"></span>';
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    }
                } else if (data.类型 === '回复就绪') {
                    // 回复就绪：隐藏状态指示器，渲染最终文本
                    let statusEl = document.getElementById('ai-status-indicator');
                    if (statusEl) statusEl.style.display = 'none';
                    if (!assistantMsg) assistantMsg = addMessage('assistant', '');
                    // 如果ReAct卡片存在且在assistantMsg前面，把assistantMsg移到ReAct卡片之后
                    const reactCard = document.getElementById('react-graph-card');
                    if (reactCard && reactCard.nextElementSibling !== assistantMsg) {
                        reactCard.insertAdjacentElement('afterend', assistantMsg);
                    }
                    if (流式缓冲) {
                        assistantMsg.innerHTML = renderMarkdown(流式缓冲);
                        enhanceCodeBlocks(assistantMsg);
                        renderClickableOptions(assistantMsg);
                    } else if (data.数据 && data.数据.回复) {
                        assistantMsg.innerHTML = renderMarkdown(data.数据.回复);
                        enhanceCodeBlocks(assistantMsg);
                        renderClickableOptions(assistantMsg);
                    }
                    assistantMsg.classList.add('msg-highlight');
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                } else if (data.类型 === '输出') {
                    // 输出：粒子到达表达后才显示
                    const 最终内容 = data.数据.内容;
                    eventQueue.push({...data, _输出回调:() => {
                        if (!assistantMsg) assistantMsg = addMessage('assistant', '');
                        assistantMsg.innerHTML = renderMarkdown(最终内容); enhanceCodeBlocks(assistantMsg); renderClickableOptions(assistantMsg);
                        assistantMsg.classList.add('msg-highlight');
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    }});
                } else if (data.类型 === '路线图') {
                    // 路线图预览：嵌入对话区，确认后保留可再次执行
                    addPlanToChat(data.数据.路线图, data.数据.ID);
                } else if (data.类型 === '路线图结果') {
                    // 路线图执行结果：直接显示在对话区，不走事件队列
                    const r = data.数据;
                    const msg = addMessage('assistant', '');
                    msg.innerHTML = `<strong style="color:#9b59b6">${r.图标 || '🔹'} ${r.ID}</strong><br>` + renderMarkdown(r.内容); enhanceCodeBlocks(msg);
                    msg.classList.add('msg-highlight');
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    播放音效(r.ID);
                } else if (data.类型 === '路线图取消') {
                    log('系统', '⏭️ 路线图已取消');
                } else if (data.类型 === '系统操作') {
                    // 系统操作——通过对话触发界面操作（如打开节点工作流）
                    _执行系统操作(data.数据.操作);
                } else if (data.类型 === 'file_change') {
                    // AI文件变更——收集到批量队列，对话完成后统一处理（避免反复切换Tab闪烁）
                    const fc = data.数据 || {};
                    const 操作 = fc.操作 || fc.工具名 || '';
                    const 路径 = fc.路径 || '';
                    console.log('[neuron] file_change 收集:', 操作, 路径, '+', fc.统计?.新增行, '-', fc.统计?.删除行);
                    if (window.editorAPI && 路径) {
                        window.editorAPI.markModified(路径);
                    }
                    // 收集到队列，完成后统一处理
                    待处理文件变更.push({操作, 路径, 数据: fc});
                    // 渲染文件变更可视化卡片（卡片可以实时显示，不影响编辑器）
                    eventQueue.push({...data, _文件变更: true});
                } else if (data.类型 === '命令卡片') {
                    // 命令执行可视化——实时显示命令+结果
                    renderCommandCard(data.数据.工具名, data.数据.参数, data.数据.结果);
                } else if (data.类型 === '权限询问') {
                    // 权限询问弹窗
                    showPermissionDialog(data.数据);
                } else if (data.类型 === '理解提问') {
                    // 理解润色师——信息不足时推送提问+选项到对话区
                    log('系统', '🤔 理解提问: ' + (data.数据.问题 || ''));
                    const 选项 = data.数据.选项 || [];
                    const askMsg = document.createElement('div');
                    askMsg.className = 'msg assistant';
                    askMsg.style.cssText = 'background:#101020;border:1px solid #2a2a44;border-radius:10px;padding:12px 16px;margin:8px 0;';
                    let html = `<div style="font-size:14px;color:#f39c12;margin-bottom:8px;">🤔 我需要确认一下</div>`
                        + `<div style="font-size:13px;color:#c8c8e0;margin-bottom:10px;">${renderMarkdown(data.数据.问题 || '')}</div>`;
                    if (选项.length > 0) {
                        html += '<div style="display:flex;flex-direction:column;gap:6px;">';
                        选项.forEach((opt, idx) => {
                            html += `<button class="clarify-option-btn" data-opt="${escapeHtml(opt)}" style="text-align:left;background:#0d0d18;border:1px solid #2a2a44;border-radius:6px;padding:8px 12px;color:#c8c8e0;font-size:13px;cursor:pointer;font-family:inherit;transition:all 0.15s;">${escapeHtml(opt)}</button>`;
                        });
                        html += '</div>';
                    } else {
                        html += `<div style="font-size:11px;color:#6666aa;margin-top:8px;">请回复补充信息，我会立即执行。</div>`;
                    }
                    askMsg.innerHTML = html;
                    messagesEl.appendChild(askMsg);
                    askMsg.querySelectorAll('.clarify-option-btn').forEach(btn => {
                        btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#4a9eff'; btn.style.background = '#151530'; });
                        btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#2a2a44'; btn.style.background = '#0d0d18'; });
                        btn.addEventListener('click', () => {
                            const opt = btn.getAttribute('data-opt');
                            askMsg.style.opacity = '0.5';
                            askMsg.style.pointerEvents = 'none';
                            if (opt === '其他' || opt === '其他（请输入）') {
                                // "其他"选项——让用户自由输入，不自动发送
                                inputBox.value = _lastUserMessage + '：';
                                inputBox.focus();
                                // 光标移到末尾
                                inputBox.setSelectionRange(inputBox.value.length, inputBox.value.length);
                                // 显示提示
                                const hint = document.createElement('div');
                                hint.style.cssText = 'font-size:11px;color:#f39c12;padding:4px 16px;';
                                hint.textContent = '请在输入框补充你想说的话，然后发送';
                                messagesEl.appendChild(hint);
                                messagesEl.scrollTop = messagesEl.scrollHeight;
                            } else {
                                // 正常选项——合并原始消息和选项
                                inputBox.value = _lastUserMessage + '，' + opt;
                                sendMessage();
                            }
                        });
                    });
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    isSending = false; sendBtn.textContent = '发送'; sendBtn.disabled = false; inputBox.focus();
                } else if (data.类型 === '任务确认') {
                    // 任务完成确认——显示任务详情+三选项
                    const 任务 = data.数据.任务 || '';
                    const 时间 = data.数据.时间 || '';
                    const taskDiv = document.createElement('div');
                    taskDiv.className = 'msg assistant';
                    taskDiv.style.cssText = 'background:#101020;border:1px solid #2a4a3a;border-radius:10px;padding:12px 16px;margin:8px 0;';
                    taskDiv.innerHTML = `
                        <div style="font-size:13px;color:#c8c8e0;margin-bottom:6px;">
                            📋 <span style="color:#4a9eff;font-weight:600;">任务状态确认</span>
                            ${时间 ? `<span style="font-size:10px;color:#555577;margin-left:8px;">${时间}</span>` : ''}
                        </div>
                        <div style="font-size:12px;color:#c8c8e0;margin-bottom:10px;padding:8px 10px;background:#0d0d18;border-radius:4px;border-left:3px solid #4a9eff;">
                            ${escapeHtml(任务)}
                        </div>
                        <div style="display:flex;gap:6px;">
                            <button class="task-done-btn" style="flex:1;background:linear-gradient(135deg,#2a5a2a,#1a4a1a);border:none;border-radius:6px;padding:8px;color:#e0ffe0;font-size:12px;cursor:pointer;font-family:inherit;">✅ 已完成</button>
                            <button class="task-pending-btn" style="flex:1;background:#2a2a3a;border:1px solid #4a4a2a;border-radius:6px;padding:8px;color:#ffd966;font-size:12px;cursor:pointer;font-family:inherit;">⏳ 待确认</button>
                            <button class="task-abandon-btn" style="flex:1;background:#2a2a3a;border:1px solid #4a2a2a;border-radius:6px;padding:8px;color:#ff8888;font-size:12px;cursor:pointer;font-family:inherit;">🗑️ 放弃任务</button>
                        </div>`;
                    messagesEl.appendChild(taskDiv);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    isSending = false; sendBtn.textContent = '发送'; sendBtn.disabled = false; inputBox.focus();
                    taskDiv.querySelector('.task-done-btn').addEventListener('click', function() {
                        taskDiv.innerHTML = `<div style="font-size:12px;color:#2ecc71;padding:4px 0;">✅ 任务已完成</div>`;
                        // 不发送消息——静默标记完成，避免触发循环
                    });
                    taskDiv.querySelector('.task-pending-btn').addEventListener('click', function() {
                        taskDiv.innerHTML = `<div style="font-size:12px;color:#ffd966;padding:4px 0;">⏳ 任务待确认，稍后再看</div>`;
                    });
                    taskDiv.querySelector('.task-abandon-btn').addEventListener('click', function() {
                        taskDiv.innerHTML = `<div style="font-size:12px;color:#8888aa;padding:4px 0;">🗑️ 任务已放弃</div>`;
                        // 不发送消息——静默放弃
                    });
                } else if (data.类型 === '操作确认') {
                    // 操作确认弹窗——LLM要求确认删除等操作时弹出
                    log('系统', '⚠️ 操作确认: ' + (data.数据.消息 || '').slice(0, 80));
                    const overlay = document.createElement('div');
                    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
                    overlay.innerHTML = `
                        <div style="background:#101020;border:1px solid #2a2a44;border-radius:12px;padding:24px 28px;max-width:440px;box-shadow:0 12px 48px rgba(0,0,0,0.6);">
                            <div style="font-size:16px;font-weight:bold;color:#f39c12;margin-bottom:12px;">⚠️ 操作确认</div>
                            <div style="font-size:13px;color:#c8c8e0;margin-bottom:16px;line-height:1.6;">${renderMarkdown((data.数据.消息 || '').slice(0, 300))}</div>
                            <div style="display:flex;gap:10px;justify-content:flex-end;">
                                <button id="confirm-yes-btn" style="background:linear-gradient(135deg,#2a5a2a,#1a4a1a);border:none;border-radius:6px;padding:8px 20px;color:#e0ffe0;font-size:13px;cursor:pointer;font-family:inherit;">✅ 确认执行</button>
                                <button id="confirm-no-btn" style="background:#3a1a1a;border:1px solid #5a2a2a;border-radius:6px;padding:8px 20px;color:#ffe0e0;font-size:13px;cursor:pointer;font-family:inherit;">❌ 取消</button>
                            </div>
                        </div>`;
                    document.body.appendChild(overlay);
                    isSending = false; sendBtn.textContent = '发送'; sendBtn.disabled = false;
                    document.getElementById('confirm-yes-btn').addEventListener('click', () => {
                        overlay.remove();
                        inputBox.value = '确认';
                        sendMessage();
                    });
                    document.getElementById('confirm-no-btn').addEventListener('click', () => {
                        overlay.remove();
                        log('系统', '⏭️ 操作已取消');
                    });
                } else if (data.类型 === '工具解锁') {
                    // 工具解锁弹窗
                    showToolUnlockDialog(data.数据);
                } else if (data.类型 === '中间交代') {
                    // 中间交代——ReAct每轮工具执行后的一句话进度汇报
                    const narrationMsg = document.createElement('div');
                    narrationMsg.className = 'msg narration';
                    narrationMsg.style.cssText = 'color:#aaaacc;font-size:12px;padding:2px 16px;font-style:italic;opacity:0.85;';
                    narrationMsg.textContent = '💬 ' + (data.数据.内容 || '');
                    messagesEl.appendChild(narrationMsg);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                } else if (data.类型 === '目标规划') {
                    // 目标规划——显示计划清单+确认按钮
                    addPlanChecklist(data.数据);
                } else if (data.类型 === '步骤完成') {
                    // 步骤完成——更新清单状态+确认按钮
                    updatePlanStep(data.数据);
                } else if (data.类型 === '目标规划取消') {
                    log('系统', '⏭️ 目标规划已取消');
                    const pc = document.getElementById('plan-checklist');
                    if (pc) pc.remove();
                } else if (data.类型 === '完成') {
                    const d = data.数据 || data.结果 || {};
                    eventQueue.push({...data, _是完成:true, _总结: d.总结, _统计: d.统计, _回复: d.回复});
                } else eventQueue.push(data);
            }
            processQueue();
        }
        while (processingEvent || eventQueue.length > 0) { await delay(100); }
        log('完成', '对话结束');
        if (window.playSound) playSound('ai-done');
        setTimeout(() => hideFloatCanvas(), 500);  // 对话完成后延迟隐藏
        // 批量处理文件变更——只切换到最后修改的文件，不闪烁
        if (待处理文件变更.length > 0 && window.editorAPI) {
            console.log('[neuron] 批量处理', 待处理文件变更.length, '个文件变更');
            // 去重：同一路径只处理最后一次操作
            const 变更Map = new Map();
            for (const fc of 待处理文件变更) {
                if (fc.操作 === 'replace_text') {
                    // replace_text需要保留每次的旧/新文本
                    if (!变更Map.has(fc.路径) || !Array.isArray(变更Map.get(fc.路径))) {
                        变更Map.set(fc.路径, []);
                    }
                    变更Map.get(fc.路径).push(fc);
                } else {
                    变更Map.set(fc.路径, fc);
                }
            }
            // 逐个处理（不切Tab，静默更新内容）
            for (const [路径, 变更] of 变更Map) {
                if (Array.isArray(变更)) {
                    // 多次replace_text
                    for (const r of 变更) {
                        await window.editorAPI.applyReplacement(路径, r.数据.旧片段 || '', r.数据.新片段 || '');
                    }
                } else {
                    await window.editorAPI.applyFileWrite(路径, 变更.操作);
                }
            }
            // 只切换到最后修改的文件
            if (变更Map.size > 0) {
                const 最后路径 = 待处理文件变更[待处理文件变更.length - 1].路径;
                if (typeof openFiles !== 'undefined' && typeof switchTab === 'function') {
                    const idx = openFiles.findIndex(f => f.path === 最后路径 && f.type !== 'document');
                    if (idx >= 0 && idx !== activeFileIdx) switchTab(idx);
                }
            }
            待处理文件变更 = [];
        }
        if (window.editorAPI) setTimeout(() => window.editorAPI.refreshAll(), 300);
    } catch (e) {
        if (e.name === 'AbortError') { log('系统', '⏹ 已停止'); }
        else { addMessage('assistant', '❌ 连接失败: '+e.message); }
        hideFloatCanvas();
    } finally { isSending = false; sendBtn.textContent = '发送'; sendBtn.disabled = false; abortController = null; inputBox.focus(); }
}

// 停止按钮：发送中点击→停止后端引擎+中断fetch+清空前端队列
sendBtn.addEventListener('click', () => {
    if (isSending) {
        eventQueue = []; processingEvent = false;
        fetch(API_BASE + '/api/stop', { method: 'POST' }).catch(() => {});
        if (abortController) abortController.abort();
    } else {
        sendMessage();
    }
});
inputBox.addEventListener('keydown', e => {
    if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); if (!isSending) sendMessage(); }
});
// textarea自动增高
inputBox.addEventListener('input', () => {
    inputBox.style.height = 'auto';
    inputBox.style.height = Math.min(inputBox.scrollHeight, 120) + 'px';
});

// ===== 语音输入 =====
let micRecognizing = false;
let micRecognition = null;
const micBtn = document.getElementById('mic-btn');
if (micBtn) {
    micBtn.addEventListener('click', () => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { log('系统', '⚠️ 浏览器不支持语音识别'); return; }
        if (micRecognizing) {
            micRecognition.stop();
            return;
        }
        micRecognition = new SR();
        micRecognition.lang = 'zh-CN';
        micRecognition.continuous = false;
        micRecognition.interimResults = true;
        micRecognition.onstart = () => {
            micRecognizing = true;
            micBtn.textContent = '⏹';
            micBtn.style.color = '#ff6b6b';
            log('系统', '🎤 语音识别中...');
        };
        micRecognition.onresult = (e) => {
            let text = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                text += e.results[i][0].transcript;
            }
            inputBox.value = text;
            inputBox.style.height = 'auto';
            inputBox.style.height = Math.min(inputBox.scrollHeight, 120) + 'px';
            if (e.results[e.results.length-1].isFinal) {
                log('系统', '🎤 识别结果: ' + text);
            }
        };
        micRecognition.onerror = (e) => {
            log('系统', '⚠️ 语音识别错误: ' + e.error);
        };
        micRecognition.onend = () => {
            micRecognizing = false;
            micBtn.textContent = '🎤';
            micBtn.style.color = '';
            log('系统', '🎤 语音识别结束');
            inputBox.focus();
        };
        micRecognition.start();
    });
}

// ===== 对话历史管理 =====
let convListOpen = false;
const convListBtn = document.getElementById('conv-list-btn');
const convDropdown = document.getElementById('conv-list-dropdown');

if (convListBtn) {
    convListBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        convListOpen = !convListOpen;
        if (convListOpen) {
            loadConvList();
            convDropdown.style.display = 'block';
        } else {
            convDropdown.style.display = 'none';
        }
    });
    // 点击外部关闭
    document.addEventListener('click', (e) => {
        if (convListOpen && !convDropdown.contains(e.target) && e.target !== convListBtn) {
            convListOpen = false;
            convDropdown.style.display = 'none';
        }
    });
}
// 关闭按钮
const convListClose = document.getElementById('conv-list-close');
if (convListClose) {
    convListClose.addEventListener('click', (e) => {
        e.stopPropagation();
        convListOpen = false;
        convDropdown.style.display = 'none';
    });
}

async function loadConvList() {
    try {
        const resp = await fetch(API_BASE + '/api/conversations');
        const data = await resp.json();
        const list = data.对话列表 || data.列表 || [];
        // 保留header，只清空列表区域
        let listContainer = document.getElementById('conv-list-items');
        if (!listContainer) {
            listContainer = document.createElement('div');
            listContainer.id = 'conv-list-items';
            convDropdown.appendChild(listContainer);
        }
        listContainer.innerHTML = '';
        if (list.length === 0) {
            listContainer.innerHTML = '<div class="conv-empty">暂无历史对话</div>';
            return;
        }
        list.forEach(c => {
            const cid = c.对话ID || c.id || '';
            const title = c.标题 || cid;
            const time = (c.最后时间 || c.更新时间 || '').substring(5, 16).replace('T', ' ');
            const el = document.createElement('div');
            el.className = 'conv-item' + (cid === 当前对话ID ? ' active' : '');
            el.innerHTML = '<span class="conv-title">' + title + '</span>'
                + '<span class="conv-time">' + time + '</span>'
                + '<span class="conv-del" title="删除">✕</span>';
            el.querySelector('.conv-title').addEventListener('click', () => switchConv(cid));
            el.querySelector('.conv-del').addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('确定删除此对话？')) deleteConv(cid);
            });
            listContainer.appendChild(el);
        });
        log('系统', '📋 加载对话列表: ' + list.length + ' 个对话');
    } catch(e) {
        let listContainer = document.getElementById('conv-list-items');
        if (listContainer) listContainer.innerHTML = '<div class="conv-empty">加载失败</div>';
        log('系统', '⚠️ 对话列表加载失败');
    }
}

async function switchConv(id) {
    if (isSending) { if (abortController) abortController.abort(); isSending = false; sendBtn.textContent = '发送'; }
    当前对话ID = id;
    convDropdown.style.display = 'none';
    convListOpen = false;
    messagesEl.innerHTML = '';
    resetDisplay();
    log('系统', '📋 切换到对话: ' + id);
    try {
        const resp = await fetch(API_BASE + '/api/conversation-messages', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id: id}),
        });
        const data = await resp.json();
        if (data.历史) {
            log('系统', '📋 加载历史消息: ' + data.历史.length + ' 条');
            data.历史.forEach(m => {
                const div = document.createElement('div');
                div.className = 'msg ' + (m.角色 === 'user' ? 'user' : 'assistant');
                if (m.角色 === 'assistant') {
                    div.innerHTML = renderMarkdown(m.内容);
                    enhanceCodeBlocks(div);
                } else {
                    div.textContent = m.内容;
                }
                messagesEl.appendChild(div);
            });
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    } catch(e) {}
    inputBox.focus();
}

async function deleteConv(id) {
    try {
        await fetch(API_BASE + '/api/conversation-delete', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id: id}),
        });
        log('系统', '🗑️ 已删除对话: ' + id);
        if (id === 当前对话ID) {
            新建对话();
        }
        loadConvList();
    } catch(e) {}
}

// 新建对话按钮——先总结上一轮，用户确认后存长期记忆，再新建
document.getElementById('new-chat-btn').addEventListener('click', async () => {
    if (isSending) { if (abortController) abortController.abort(); eventQueue = []; processingEvent = false; isSending = false; sendBtn.textContent = '发送'; sendBtn.disabled = false; }

    const 上一个对话ID = 当前对话ID;
    const 有消息 = messagesEl.querySelectorAll('.msg').length > 0;

    if (有消息) {
        log('系统', '🔍 正在总结上一轮对话...');
        try {
            const resp = await fetch(API_BASE + '/api/summarize', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({对话ID: 上一个对话ID}),
            });
            const 数据 = await resp.json();

            if (数据.值得记忆 && 数据.标题) {
                // 弹窗展示，用户确认
                showSummaryModal(数据, () => 新建对话());
            } else {
                log('系统', '🔍 无需长期记忆');
                新建对话();
            }
        } catch (e) {
            log('系统', '⚠️ 总结失败: ' + e.message);
            新建对话();
        }
    } else {
        新建对话();
    }
    inputBox.focus();
});

// 总结弹窗
function showSummaryModal(数据, onDone) {
    const modal = document.getElementById('summary-modal');
    const content = document.getElementById('summary-content');
    if (!modal || !content) { if (onDone) onDone(); return; }
    content.innerHTML = `
        <div class="summary-label">标题</div>
        <div class="summary-title">${数据.标题}</div>
        <div class="summary-label">内容</div>
        <div class="summary-body">${数据.内容}</div>
    `;
    modal.style.display = 'flex';

    const skipBtn = document.getElementById('summary-skip');
    const saveBtn = document.getElementById('summary-save');

    const cleanup = () => { modal.style.display = 'none'; skipBtn.onclick = null; saveBtn.onclick = null; };

    skipBtn.onclick = () => { cleanup(); log('系统', '⏭️ 跳过长期记忆'); onDone(); };
    saveBtn.onclick = async () => {
        cleanup();
        try {
            await fetch(API_BASE + '/api/promote-memory', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({标题: 数据.标题, 内容: 数据.内容}),
            });
            log('系统', '✅ 已存入长期记忆: ' + 数据.标题);
        } catch (e) { log('系统', '⚠️ 保存失败'); }
        onDone();
    };
}

// ===== 状态加载 =====
async function fetchStatus() {
    try {
        const resp = await fetch(API_BASE + '/api/status'), data = await resp.json();
        if (data.神经元 && neurons.length === 0) data.神经元.forEach(bn => neurons.push(makeNeuron(bn.名称, bn.图标, bn.层)));
        if (data.突触) synapses = data.突触;
        document.getElementById('neuron-count').textContent = `${neurons.length} 个神经元`;
    } catch (e) {}
}

// ===== 动画开关 + 速度调节 =====
const animToggle = document.getElementById('anim-toggle');
if (animToggle) {
// 初始化按钮显示（从localStorage恢复）
animToggle.textContent = 动画启用 ? '⚡' : '⚡⏭';
animToggle.style.color = 动画启用 ? '#4a9eff' : '#2ecc71';
animToggle.addEventListener('click', () => {
    动画启用 = !动画启用;
    animToggle.textContent = 动画启用 ? '⚡' : '⚡⏭';
    animToggle.style.color = 动画启用 ? '#4a9eff' : '#2ecc71';
    try { localStorage.setItem('animEnabled', 动画启用 ? 'true' : 'false'); } catch(e) {}
    log('系统', 动画启用 ? '动画已开启' : '动画已关闭（极速模式）');
});

// ===== 声音开关 =====
// 在动画按钮右侧创建声音按钮
const soundToggle = document.createElement('button');
soundToggle.id = 'sound-toggle';
soundToggle.textContent = 声音启用 ? '🔊' : '🔇';
soundToggle.style.cssText = 'background:transparent;border:none;color:' + (声音启用 ? '#4a9eff' : '#555577') + ';font-size:18px;cursor:pointer;padding:4px 6px;border-radius:4px;transition:all 0.2s;';
soundToggle.title = '点击切换声音开关';
soundToggle.addEventListener('click', () => {
    声音启用 = !声音启用;
    soundToggle.textContent = 声音启用 ? '🔊' : '🔇';
    soundToggle.style.color = 声音启用 ? '#4a9eff' : '#555577';
    try { localStorage.setItem('soundEnabled', 声音启用 ? 'true' : 'false'); } catch(e) {}
    log('系统', 声音启用 ? '声音已开启' : '声音已关闭');
    // 开启时播放测试音
    if (声音启用) 播放传输音(true);
});
animToggle.parentNode.insertBefore(soundToggle, animToggle.nextSibling);

// 速度调节弹窗
let speedPopup = null;
animToggle.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!speedPopup) {
        speedPopup = document.createElement('div');
        speedPopup.style.cssText = 'position:fixed;z-index:9000;background:#0d0d18;border:1px solid #2a2a44;border-radius:8px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:6px;';
        speedPopup.innerHTML = '<label style="font-size:11px;color:#8888aa;">动画速度</label>'
            + '<div style="display:flex;align-items:center;gap:8px;">'
            + '<input type="range" id="anim-speed-slider" min="0.5" max="5" step="0.5" value="' + 动画速度 + '" style="width:120px;">'
            + '<span id="anim-speed-val" style="font-size:12px;color:#4a9eff;min-width:32px;font-family:monospace;">' + 动画速度.toFixed(1) + 'x</span>'
            + '</div>';
        document.body.appendChild(speedPopup);
        const slider = speedPopup.querySelector('#anim-speed-slider');
        const valSpan = speedPopup.querySelector('#anim-speed-val');
        slider.addEventListener('input', () => {
            动画速度 = parseFloat(slider.value);
            valSpan.textContent = 动画速度.toFixed(1) + 'x';
            localStorage.setItem('animSpeed', 动画速度);
        });
        // 点击外部关闭
        document.addEventListener('click', function closeSpeed(ev) {
            if (speedPopup && !speedPopup.contains(ev.target) && ev.target !== animToggle) {
                speedPopup.style.display = 'none';
            }
        });
    }
    const rect = animToggle.getBoundingClientRect();
    speedPopup.style.display = 'flex';
    speedPopup.style.left = rect.left + 'px';
    speedPopup.style.top = (rect.bottom + 4) + 'px';
});
} // end if(animToggle)

// 初始化——每个调用都做防御
try {
    if (typeof resizeCanvas === 'function') resizeCanvas();
    if (typeof fetchStatus === 'function') fetchStatus();
    if (inputBox) inputBox.focus();
    if (typeof render === 'function') requestAnimationFrame(render);
} catch(e) { console.error('[neuron] 初始化失败:', e); }

// ===== 右侧Tab面板：对话/控制台切换 =====
const panelArea = document.getElementById('panel-area');
const chatPanel = document.getElementById('chat-panel');
const consolePanel = document.getElementById('console-panel');
let currentTab = 'chat';

// Tab切换
document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        currentTab = target;
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
        if (target === 'chat') {
            chatPanel.classList.add('active');
        } else {
            consolePanel.classList.add('active');
            const cb = document.getElementById('console-body');
            cb.scrollTop = cb.scrollHeight;
        }
    });
});

// === 角色面板 ===
function loadRoles() {
    // 兼容旧调用（如果role-list存在）
    const el = document.getElementById('role-list');
    if (el) loadRolesIntoPanel(el, null, null);
}

function loadRolesIntoPanel(container, 路线图, onModified) {
    fetch(API_BASE + '/api/roles').then(r => r.json()).then(roles => {
        if (!roles || roles.length === 0) {
            container.innerHTML = '<div style="color:#555577;text-align:center;padding:20px;font-size:12px">暂无角色<br><span style="font-size:10px">在对话中创建角色后自动出现</span></div>';
            return;
        }
        // 按标签分组
        const groups = {};
        const groupOrder = []; // 保持分组顺序
        for (const r of roles) {
            const g = r.标签 || '未分类';
            if (!groups[g]) { groups[g] = []; groupOrder.push(g); }
            groups[g].push(r);
        }
        let html = '<div style="padding:4px 6px;display:flex;gap:4px">'
            + '<button class="rm-role-new modal-btn modal-btn-primary" style="flex:1;font-size:11px;padding:4px">➕ 新建角色</button>'
            + '<button class="rm-group-new modal-btn" style="font-size:11px;padding:4px" title="新建分组">📁</button>'
            + '</div>';
        html += '<div class="rm-drop-zone" style="padding:6px;text-align:center;font-size:10px;color:#555577;border:1px dashed #2a2a44;border-radius:4px;margin:2px 6px">拖到此处脱离分组</div>';
        for (const g of groupOrder) {
            const items = groups[g];
            html += `<div class="role-group" data-group-name="${g}">
                <div class="role-group-header">
                    <span class="toggle">▼</span>
                    <span class="gname">${g} (${items.length})</span>
                </div><div class="role-group-items">`;
            for (const r of items) {
                html += `<div class="role-item" draggable="true" data-role-name="${r.标题}" data-role-desc="${(r.内容||'').slice(0,100)}" data-role-prompt="${(r.内容||'').replace(/"/g,'&quot;')}" data-role-tags="${r.关键词||''}" data-role-group="${g}">
                    <span class="role-icon">🎭</span>
                    <span class="role-name">${r.标题}</span>
                </div>`;
            }
            html += '</div></div>';
        }
        container.innerHTML = html;

        // 新建角色/分组
        container.querySelector('.rm-role-new')?.addEventListener('click', () => showRoleEditor(null));
        container.querySelector('.rm-group-new')?.addEventListener('click', () => {
            const name = prompt('新分组名称:', '');
            if (name && name.trim()) {
                // 创建一个空分组：保存一个临时角色到新分组然后删除角色只留分组
                // 简单方案：直接在UI上添加空分组
                const grp = document.createElement('div');
                grp.className = 'role-group';
                grp.dataset.groupName = name.trim();
                grp.innerHTML = `<div class="role-group-header"><span class="toggle" onclick="this.parentElement.parentElement.classList.toggle('collapsed')">▼</span><span class="gname" onclick="this.parentElement.parentElement.classList.toggle('collapsed')">${name.trim()} (0)</span></div><div class="role-group-items"></div>`;
                container.appendChild(grp);
                bindGroupEvents(grp, container);
            }
        });

        // 绑定所有角色项事件
        container.querySelectorAll('.role-item').forEach(item => bindRoleItem(item, container));
        // 绑定所有分组事件
        container.querySelectorAll('.role-group').forEach(grp => bindGroupEvents(grp, container));

        // === 追加工具分组 ===
        const TOOLS_LIST = [
            {name:'read_file', icon:'📄', label:'读取文件'},
            {name:'write_file', icon:'✏️', label:'写入文件'},
            {name:'create_file', icon:'📝', label:'创建文件'},
            {name:'list_dir', icon:'📁', label:'列出目录'},
            {name:'search_code', icon:'🔍', label:'搜索代码'},
            {name:'run_command', icon:'💻', label:'运行命令'},
            {name:'get_time', icon:'🕐', label:'获取时间'},
            {name:'file_info', icon:'📊', label:'文件信息'},
            {name:'read_lines', icon:'📐', label:'读指定行'},
            {name:'read_head', icon:'📐', label:'读头部'},
            {name:'read_tail', icon:'📐', label:'读尾部'},
            {name:'tree_dir', icon:'🌳', label:'目录树'},
        ];
        let toolsHtml = '<div class="role-group" data-group-name="工具"><div class="role-group-header"><span class="toggle">▼</span><span class="gname">🔧 工具 (' + TOOLS_LIST.length + ')</span></div><div class="role-group-items">';
        for (const t of TOOLS_LIST) {
            toolsHtml += `<div class="role-item tool-item" draggable="true" data-tool-name="${t.name}" data-tool-label="${t.label}">
                <span class="role-icon">${t.icon}</span>
                <span class="role-name">${t.label}</span>
            </div>`;
        }
        toolsHtml += '</div></div>';
        container.insertAdjacentHTML('beforeend', toolsHtml);
        // 绑定工具项拖拽——拖到SVG创建工具节点
        container.querySelectorAll('.tool-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    kind: 'tool', name: item.dataset.toolName, label: item.dataset.toolLabel,
                }));
                e.dataTransfer.effectAllowed = 'copy';
                item.classList.add('dragging');
            });
            item.addEventListener('dragend', () => { item.classList.remove('dragging'); });
            item.addEventListener('dblclick', () => {
                // 双击提示：拖到画布上使用
                item.style.background = 'rgba(74,158,255,0.2)';
                setTimeout(() => { item.style.background = ''; }, 800);
            });
        });
        // 工具分组也绑定折叠
        const toolGrp = container.querySelector('.role-group[data-group-name="工具"]');
        if (toolGrp) bindGroupEvents(toolGrp, container);
        // 脱离分组区域
        const dropZone = container.querySelector('.rm-drop-zone');
        if (dropZone) {
            dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.background = 'rgba(74,158,255,0.15)'; });
            dropZone.addEventListener('dragleave', () => { dropZone.style.background = ''; });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.style.background = '';
                const dragging = container.querySelector('.role-item.dragging');
                if (!dragging) return;
                // 脱离分组：改为"未分类"
                const name = dragging.dataset.roleName;
                const prompt = dragging.dataset.rolePrompt;
                const tags = dragging.dataset.roleTags;
                // 保存到DB，标签改为"未分类"
                fetch(API_BASE + '/api/roles/save', {method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({标题: name, 内容: prompt, 关键词: tags, 标签: '未分类'})})
                .then(() => loadRolesIntoPanel(container, 路线图, onModified));
            });
        }
    }).catch(e => {
        container.innerHTML = '<div style="color:#e74c3c;padding:10px;font-size:11px">加载失败</div>';
    });
}

function bindRoleItem(item, container) {
    // 拖拽到路线图创建节点
    item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
            kind: 'role', name: item.dataset.roleName,
            prompt: item.dataset.rolePrompt, desc: item.dataset.roleDesc,
        }));
        e.dataTransfer.effectAllowed = 'copyMove';
        item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); });
    // 上下拖拽排序（同组内）
    item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = container.querySelector('.role-item.dragging');
        if (!dragging || dragging === item) return;
        const rect = item.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        if (after) item.after(dragging); else item.before(dragging);
    });
    // 双击编辑
    item.addEventListener('dblclick', () => {
        showRoleEditor({标题: item.dataset.roleName, 内容: item.dataset.rolePrompt, 关键词: item.dataset.roleTags, 标签: item.dataset.roleGroup});
    });
    // 右键菜单
    item.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showRoleContextMenu(e.clientX, e.clientY, item, container);
    });
}

function bindGroupEvents(grp, container) {
    const header = grp.querySelector('.role-group-header');
    if (!header) return;
    // 点击展开/收起（用mousedown+移动检测，避免与拖拽冲突）
    let mouseDownX = 0, mouseDownY = 0, didDrag = false;
    header.addEventListener('mousedown', (e) => {
        mouseDownX = e.clientX; mouseDownY = e.clientY; didDrag = false;
    });
    header.addEventListener('click', (e) => {
        if (didDrag) return;  // 拖拽过就不触发折叠
        grp.classList.toggle('collapsed');
        const toggle = header.querySelector('.toggle');
        if (toggle) toggle.style.transform = grp.classList.contains('collapsed') ? 'rotate(-90deg)' : '';
    });
    // 分组拖拽排序（draggable设在header上）
    header.draggable = true;
    header.addEventListener('dragstart', (e) => {
        didDrag = true;
        e.dataTransfer.setData('text/group', grp.dataset.groupName);
        e.dataTransfer.effectAllowed = 'move';
        grp.classList.add('grp-dragging');
    });
    header.addEventListener('dragend', () => { grp.classList.remove('grp-dragging'); setTimeout(() => { didDrag = false; }, 50); });
    header.addEventListener('dragover', (e) => {
        const draggingGrp = container.querySelector('.role-group.grp-dragging');
        if (!draggingGrp || draggingGrp === grp) return;
        e.preventDefault();
        const rect = grp.getBoundingClientRect();
        if (e.clientY > rect.top + rect.height / 2) grp.after(draggingGrp); else grp.before(draggingGrp);
    });
    // 角色拖入分组：dragover高亮 + drop改分组
    grp.addEventListener('dragover', (e) => {
        const dragging = container.querySelector('.role-item.dragging');
        if (!dragging) return;
        e.preventDefault();
        grp.style.background = 'rgba(74,158,255,0.1)';
    });
    grp.addEventListener('dragleave', () => { grp.style.background = ''; });
    grp.addEventListener('drop', (e) => {
        e.preventDefault();
        grp.style.background = '';
        const dragging = container.querySelector('.role-item.dragging');
        if (!dragging) return;
        const newGroup = grp.dataset.groupName;
        const oldGroup = dragging.dataset.roleGroup;
        if (newGroup === oldGroup) return;
        // 保存到DB，改分组
        const name = dragging.dataset.roleName;
        const prompt = dragging.dataset.rolePrompt;
        const tags = dragging.dataset.roleTags;
        fetch(API_BASE + '/api/roles/save', {method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({标题: name, 内容: prompt, 关键词: tags, 标签: newGroup})})
        .then(() => {
            // 更新dataset，不重新加载全部
            dragging.dataset.roleGroup = newGroup;
            grp.querySelector('.role-group-items').appendChild(dragging);
            // 更新计数
            updateGroupCounts(container);
        });
    });
    // 双击重命名分组
    header.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const oldName = grp.dataset.groupName;
        const newName = prompt('分组名称:', oldName);
        if (!newName || newName.trim() === oldName) return;
        // 更新DB中该分组所有角色的标签
        grp.querySelectorAll('.role-item').forEach(item => {
            fetch(API_BASE + '/api/roles/save', {method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({标题: item.dataset.roleName, 内容: item.dataset.rolePrompt, 关键词: item.dataset.roleTags, 标签: newName.trim()})});
            item.dataset.roleGroup = newName.trim();
        });
        grp.dataset.groupName = newName.trim();
        grp.querySelector('.gname').textContent = newName.trim() + ' (' + grp.querySelectorAll('.role-item').length + ')';
    });
    // 右键分组菜单
    header.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showGroupContextMenu(e.clientX, e.clientY, grp, container);
    });
}

function updateGroupCounts(container) {
    container.querySelectorAll('.role-group').forEach(grp => {
        const count = grp.querySelectorAll('.role-item').length;
        const nameEl = grp.querySelector('.gname');
        if (nameEl) nameEl.textContent = grp.dataset.groupName + ' (' + count + ')';
    });
}

function showRoleContextMenu(x, y, item, container) {
    const old = document.querySelector('.rm-context-menu');
    if (old) old.remove();
    const menu = document.createElement('div');
    menu.className = 'rm-context-menu';
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    const items = [
        {label:'✏️ 编辑角色', action:() => {
            showRoleEditor({标题: item.dataset.roleName, 内容: item.dataset.rolePrompt, 关键词: item.dataset.roleTags, 标签: item.dataset.roleGroup});
        }},
        {label:'🔄 修改分组', action:() => {
            const newGrp = prompt('分组名称:', item.dataset.roleGroup || '未分类');
            if (!newGrp) return;
            fetch(API_BASE + '/api/roles/save', {method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({标题: item.dataset.roleName, 内容: item.dataset.rolePrompt, 关键词: item.dataset.roleTags, 标签: newGrp.trim()})})
            .then(() => loadRolesIntoPanel(container, null, null));
        }},
        {sep:true},
        {label:'🗑️ 删除角色', danger:true, action:() => {
            if (!confirm('删除角色「' + item.dataset.roleName + '」?')) return;
            fetch(API_BASE + '/api/roles/delete', {method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({标题: item.dataset.roleName})})
            .then(() => loadRolesIntoPanel(container, null, null));
        }},
    ];
    menu.innerHTML = items.map((it,i) => it.sep ? '<div class="rm-menu-sep"></div>' : `<div class="rm-menu-item ${it.danger?'rm-menu-danger':''}" data-idx="${i}">${it.label}</div>`).join('');
    document.body.appendChild(menu);
    menu.querySelectorAll('.rm-menu-item').forEach((el, i) => {
        el.addEventListener('click', () => { items[parseInt(el.dataset.idx)].action(); menu.remove(); });
    });
    setTimeout(() => {
        const closer = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closer); }};
        document.addEventListener('click', closer);
    }, 0);
}

function showGroupContextMenu(x, y, grp, container) {
    const old = document.querySelector('.rm-context-menu');
    if (old) old.remove();
    const menu = document.createElement('div');
    menu.className = 'rm-context-menu';
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    const items = [
        {label:'✏️ 重命名分组', action:() => {
            const oldName = grp.dataset.groupName;
            const newName = prompt('分组名称:', oldName);
            if (!newName || newName.trim() === oldName) return;
            grp.querySelectorAll('.role-item').forEach(item => {
                fetch(API_BASE + '/api/roles/save', {method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({标题: item.dataset.roleName, 内容: item.dataset.rolePrompt, 关键词: item.dataset.roleTags, 标签: newName.trim()})});
                item.dataset.roleGroup = newName.trim();
            });
            grp.dataset.groupName = newName.trim();
            grp.querySelector('.gname').textContent = newName.trim() + ' (' + grp.querySelectorAll('.role-item').length + ')';
        }},
        {sep:true},
        {label:'🗑️ 删除分组(角色移到未分类)', danger:true, action:() => {
            grp.querySelectorAll('.role-item').forEach(item => {
                fetch(API_BASE + '/api/roles/save', {method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({标题: item.dataset.roleName, 内容: item.dataset.rolePrompt, 关键词: item.dataset.roleTags, 标签: '未分类'})});
            });
            grp.remove();
        }},
    ];
    menu.innerHTML = items.map((it,i) => it.sep ? '<div class="rm-menu-sep"></div>' : `<div class="rm-menu-item ${it.danger?'rm-menu-danger':''}" data-idx="${i}">${it.label}</div>`).join('');
    document.body.appendChild(menu);
    menu.querySelectorAll('.rm-menu-item').forEach((el, i) => {
        el.addEventListener('click', () => { items[parseInt(el.dataset.idx)].action(); menu.remove(); });
    });
    setTimeout(() => {
        const closer = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closer); }};
        document.addEventListener('click', closer);
    }, 0);
}

function showRoleEditor(role) {
    const isNew = !role;
    const r = role || {标题: '', 内容: '', 关键词: '', 标签: '其他'};
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width:460px">
            <div class="modal-title">${isNew?'➕ 新建角色':'✏️ 编辑角色'}</div>
            <div style="margin-bottom:10px">
                <div style="font-size:10px;color:#8888aa;margin-bottom:2px">角色名（标题）</div>
                <input id="re-name" value="${(r.标题||'').replace(/"/g,'&quot;')}" placeholder="如：翻译官" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:14px;outline:none;">
            </div>
            <div style="margin-bottom:10px">
                <div style="font-size:10px;color:#8888aa;margin-bottom:2px">分组（标签）</div>
                <input id="re-tags" value="${(r.标签||'其他').replace(/"/g,'&quot;')}" placeholder="如：翻译组" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:13px;outline:none;">
            </div>
            <div style="margin-bottom:10px">
                <div style="font-size:10px;color:#8888aa;margin-bottom:2px">人设（系统提示词）</div>
                <textarea id="re-content" rows="5" placeholder="如：你是翻译专家，精通中英翻译..." style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:12px;outline:none;resize:vertical;font-family:inherit;">${(r.内容||'').replace(/</g,'&lt;')}</textarea>
            </div>
            <div style="margin-bottom:10px">
                <div style="font-size:10px;color:#8888aa;margin-bottom:2px">关键词（用空格分隔，便于搜索召回）</div>
                <input id="re-keywords" value="${(r.关键词||'').replace(/"/g,'&quot;')}" placeholder="如：翻译 英语 中文" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:13px;outline:none;">
            </div>
            <div style="display:flex;gap:6px;margin-bottom:10px">
                <button id="re-aigen" class="modal-btn" style="font-size:11px">🤖 AI生成人设</button>
                ${!isNew?'<button id="re-delete" class="modal-btn" style="font-size:11px;color:#e74c3c">🗑️ 删除</button>':''}
            </div>
            <div class="modal-actions">
                <button id="re-cancel" class="modal-btn">取消</button>
                <button id="re-ok" class="modal-btn modal-btn-primary">保存</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#re-cancel').onclick = close;
    overlay.querySelector('#re-ok').onclick = () => {
        const data = {
            标题: overlay.querySelector('#re-name').value.trim(),
            内容: overlay.querySelector('#re-content').value,
            关键词: overlay.querySelector('#re-keywords').value.trim(),
            标签: overlay.querySelector('#re-tags').value.trim() || '其他',
        };
        if (!data.标题) { alert('请填写角色名'); return; }
        fetch(API_BASE + '/api/roles/save', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)})
        .then(r => r.json()).then(d => {
            if (d.错误) { alert(d.错误); return; }
            close();
            loadRoles();
            log('系统', '✅ 角色已保存: ' + data.标题);
        });
    };
    if (!isNew) {
        overlay.querySelector('#re-delete').onclick = () => {
            if (!confirm('删除角色「' + r.标题 + '」?')) return;
            fetch(API_BASE + '/api/roles/delete', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({标题: r.标题})})
            .then(r => r.json()).then(d => {
                close();
                loadRoles();
                log('系统', '🗑️ 角色已删除: ' + r.标题);
            });
        };
    }
    overlay.querySelector('#re-aigen').onclick = () => {
        const 名称 = overlay.querySelector('#re-name').value.trim();
        const btn = overlay.querySelector('#re-aigen');
        btn.textContent = '⏳'; btn.disabled = true;
        fetch(API_BASE + '/api/roadmap/gen-prompt', {method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({类型:'角色', 名称, 描述: overlay.querySelector('#re-tags').value.trim()})})
        .then(r => r.json()).then(d => {
            btn.textContent = '🤖 AI生成人设'; btn.disabled = false;
            if (d.提示词) overlay.querySelector('#re-content').value = d.提示词;
        }).catch(e => { btn.textContent = '🤖 AI生成人设'; btn.disabled = false; });
    };
}

// ===== 浮空Canvas面板：拖拽移动 + 缩放 + 显示/隐藏 + 位置记忆 =====
const floatCanvas = document.getElementById('float-canvas-container');
const floatHeader = document.getElementById('float-canvas-header');
const floatClose = document.getElementById('float-canvas-close');

// 从localStorage恢复位置和尺寸
function _restoreFloatCanvasState() {
    if (!floatCanvas) return;
    try {
        const saved = JSON.parse(localStorage.getItem('floatCanvasState') || '{}');
        const w = saved.width || 320, h = saved.height || 280;
        let left = saved.left, top = saved.top;
        // 边界检查：确保面板在屏幕内可见
        if (left != null) {
            left = Math.max(0, Math.min(left, window.innerWidth - 100));
            floatCanvas.style.left = left + 'px';
        }
        if (top != null) {
            top = Math.max(0, Math.min(top, window.innerHeight - 100));
            floatCanvas.style.top = top + 'px';
        }
        if (saved.width != null) floatCanvas.style.width = w + 'px';
        if (saved.height != null) floatCanvas.style.height = h + 'px';
    } catch(e) {}
}
function _saveFloatCanvasState() {
    if (!floatCanvas) return;
    const rect = floatCanvas.getBoundingClientRect();
    localStorage.setItem('floatCanvasState', JSON.stringify({
        left: rect.left, top: rect.top, width: rect.width, height: rect.height
    }));
}

let _hideFloatTimer = null;

function showFloatCanvas() {
    if (!floatCanvas) { console.warn('[neuron] showFloatCanvas: floatCanvas元素不存在'); return; }
    if (_hideFloatTimer) { clearTimeout(_hideFloatTimer); _hideFloatTimer = null; }
    _restoreFloatCanvasState();
    floatCanvas.style.display = 'block';
    floatCanvas.style.opacity = '0';
    floatCanvas.style.transform = 'scale(0.8)';
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            floatCanvas.style.opacity = '1';
            floatCanvas.style.transform = 'scale(1)';
        });
    });
    setTimeout(resizeCanvas, 50);
}

function hideFloatCanvas() {
    if (!floatCanvas) return;
    floatCanvas.style.opacity = '0';
    floatCanvas.style.transform = 'scale(0.8)';
    if (_hideFloatTimer) clearTimeout(_hideFloatTimer);
    _hideFloatTimer = setTimeout(() => { if (floatCanvas) floatCanvas.style.display = 'none'; _hideFloatTimer = null; }, 300);
}

if (floatClose) floatClose.addEventListener('click', hideFloatCanvas);

// --- 拖拽移动 ---
let isDraggingFloat = false, dragOffsetX = 0, dragOffsetY = 0;
if (floatHeader) {
    floatHeader.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDraggingFloat = true;
        const rect = floatCanvas.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        document.body.style.cursor = 'move';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
}
document.addEventListener('mousemove', (e) => {
    if (isDraggingFloat) {
        floatCanvas.style.left = (e.clientX - dragOffsetX) + 'px';
        floatCanvas.style.top = (e.clientY - dragOffsetY) + 'px';
        floatCanvas.style.right = 'auto';
    }
});
document.addEventListener('mouseup', () => {
    if (isDraggingFloat) {
        isDraggingFloat = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        _saveFloatCanvasState();
    }
});

// --- 多方向缩放 ---
let isResizingFloat = false, resizeDir = '', rsx = 0, rsy = 0, rsW = 0, rsH = 0, rsL = 0, rsT = 0;
['float-resize-r', 'float-resize-b', 'float-resize-br', 'float-resize-t', 'float-resize-l'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        isResizingFloat = true;
        resizeDir = id.replace('float-resize-', '');
        rsx = e.clientX; rsy = e.clientY;
        rsW = floatCanvas.offsetWidth; rsH = floatCanvas.offsetHeight;
        rsL = floatCanvas.offsetLeft; rsT = floatCanvas.offsetTop;
        document.body.style.userSelect = 'none';
    });
});
document.addEventListener('mousemove', (e) => {
    if (!isResizingFloat) return;
    const dx = e.clientX - rsx, dy = e.clientY - rsy;
    if (resizeDir === 'r' || resizeDir === 'br') {
        const w = Math.max(180, rsW + dx);
        floatCanvas.style.width = w + 'px';
    }
    if (resizeDir === 'b' || resizeDir === 'br') {
        const h = Math.max(140, rsH + dy);
        floatCanvas.style.height = h + 'px';
    }
    if (resizeDir === 't') {
        const h = Math.max(140, rsH - dy);
        floatCanvas.style.height = h + 'px';
        floatCanvas.style.top = (rsT + dy) + 'px';
    }
    if (resizeDir === 'l') {
        const w = Math.max(180, rsW - dx);
        floatCanvas.style.width = w + 'px';
        floatCanvas.style.left = (rsL + dx) + 'px';
    }
    resizeCanvas();
});
document.addEventListener('mouseup', () => {
    if (isResizingFloat) {
        isResizingFloat = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        _saveFloatCanvasState();
    }
});

// ===== 目标规划清单 =====
function addPlanChecklist(数据) {
    const 计划 = 数据.计划 || [];
    const planID = 数据.ID || '';
    log('系统', `📋 收到目标规划：${计划.length}个步骤`);

    // 移除旧清单
    const old = document.getElementById('plan-checklist');
    if (old) old.remove();

    const div = document.createElement('div');
    div.id = 'plan-checklist';
    div.className = 'msg assistant';
    div.style.cssText = 'background:#101020;border:1px solid #2a2a44;border-radius:10px;padding:12px 16px;margin:8px 0;';

    let html = '<div style="font-size:14px;font-weight:bold;color:#4a9eff;margin-bottom:10px;">📋 目标规划</div>';
    html += '<div style="display:flex;flex-direction:column;gap:5px;">';
    计划.forEach((step, i) => {
        // 去掉步骤文本中已有的编号前缀（如"1.xxx"或"1. xxx"）
        let 干净步骤 = step.replace(/^\s*\d+[\.\、\)]\s*/, '').trim();
        html += `<div id="plan-step-${i+1}" style="display:flex;align-items:flex-start;gap:8px;padding:6px 10px;border-radius:6px;background:#0d0d18;font-size:13px;color:#c8c8e0;">`
            + `<span id="plan-icon-${i+1}" style="font-size:14px;flex-shrink:0;margin-top:1px;">⬜</span>`
            + `<span style="flex:1;"><b style="color:#4a9eff;">${i+1}.</b> ${干净步骤}</span>`
            + `</div>`;
    });
    html += '</div>';

    // 确认/取消按钮
    html += `<div style="display:flex;gap:8px;margin-top:10px;">`;
    html += `<button id="plan-confirm-btn" style="background:linear-gradient(135deg,#2a4a8a,#1a3a7a);border:none;border-radius:6px;padding:6px 18px;color:#e0e8ff;font-size:13px;cursor:pointer;font-family:inherit;">✅ 确认开始</button>`;
    html += `<button id="plan-cancel-btn" style="background:#1a1a2e;border:1px solid #2a2a44;border-radius:6px;padding:6px 18px;color:#8888aa;font-size:13px;cursor:pointer;font-family:inherit;">取消</button>`;
    html += `</div>`;

    div.innerHTML = html;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    document.getElementById('plan-confirm-btn').addEventListener('click', () => {
        fetch(API_BASE + '/api/plan-approve', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({操作:'确认', ID:planID})
        }).catch(() => {});
        div.querySelector('#plan-confirm-btn').disabled = true;
        div.querySelector('#plan-confirm-btn').textContent = '⏳ 执行中...';
        div.querySelector('#plan-cancel-btn').style.display = 'none';
    });
    document.getElementById('plan-cancel-btn').addEventListener('click', () => {
        fetch(API_BASE + '/api/plan-approve', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({操作:'取消', ID:planID})
        }).catch(() => {});
        div.remove();
    });
}

function updatePlanStep(数据) {
    const 步骤 = 数据.步骤 || 0;
    const 描述 = 数据.描述 || '';
    const 总数 = 数据.总数 || 0;
    const planID = 数据.ID || '';
    log('系统', `✅ 步骤${步骤}/${总数}完成: ${描述}`);

    // 更新步骤图标为✅
    const icon = document.getElementById(`plan-icon-${步骤}`);
    if (icon) icon.textContent = '✅';
    const stepDiv = document.getElementById(`plan-step-${步骤}`);
    if (stepDiv) stepDiv.style.opacity = '0.7';

    // 在清单底部添加审核按钮
    const checklist = document.getElementById('plan-checklist');
    if (!checklist) return;

    // 移除旧的审核按钮
    const oldReview = document.getElementById('plan-review-bar');
    if (oldReview) oldReview.remove();

    const reviewBar = document.createElement('div');
    reviewBar.id = 'plan-review-bar';
    reviewBar.style.cssText = 'display:flex;gap:8px;margin-top:10px;align-items:center;';
    const isLast = 步骤 >= 总数;
    reviewBar.innerHTML = `<span style="font-size:12px;color:#8888aa;margin-right:8px;">步骤${步骤}已完成，请审核：</span>`
        + `<button id="plan-approve-btn" style="background:#2a5a2a;border:none;border-radius:6px;padding:5px 14px;color:#e0ffe0;font-size:12px;cursor:pointer;">✅ 通过</button>`
        + `<button id="plan-reject-btn" style="background:#5a2a2a;border:none;border-radius:6px;padding:5px 14px;color:#ffe0e0;font-size:12px;cursor:pointer;">❌ 打回</button>`;

    checklist.appendChild(reviewBar);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    document.getElementById('plan-approve-btn').addEventListener('click', () => {
        fetch(API_BASE + '/api/plan-approve', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({操作:'确认', ID:planID})
        }).catch(() => {});
        reviewBar.remove();
    });
    document.getElementById('plan-reject-btn').addEventListener('click', () => {
        const 反馈 = prompt('请输入修改意见（可选）：') || '请修改';
        fetch(API_BASE + '/api/plan-approve', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({操作:'拒绝', ID:planID, 反馈})
        }).catch(() => {});
        reviewBar.remove();
    });
}

// ===== 路线图嵌入对话区 =====
function addPlanToChat(路线图, 路线图ID) {
    const div = document.createElement('div');
    div.className = 'msg assistant';
    div.style.cssText = 'border:1px solid #2a4a8a;background:linear-gradient(135deg,#0d0d20,#101028);padding:12px;margin-bottom:10px;border-radius:12px;position:relative;';

    // 描述
    const desc = document.createElement('div');
    desc.style.cssText = 'color:#aaaacc;font-size:13px;margin-bottom:8px;';
    desc.textContent = '📋 ' + (路线图.描述 || '路线图预览');
    div.appendChild(desc);

    // === 工具栏 ===
    const toolbar = document.createElement('div');
    toolbar.className = 'rm-toolbar';
    toolbar.innerHTML = `
        <button class="rm-tool-btn" data-action="add" title="添加节点">➕</button>
        <button class="rm-tool-btn" data-action="save" title="保存路线图">💾</button>
        <button class="rm-tool-btn" data-action="load" title="读取路线图">📂</button>
        <span class="rm-tool-sep"></span>
        <button class="rm-tool-btn" data-action="undo" title="撤销 (Ctrl+Z)">↶</button>
        <button class="rm-tool-btn" data-action="redo" title="重做 (Ctrl+Y)">↷</button>
        <span class="rm-tool-sep"></span>
        <button class="rm-tool-btn" data-action="zoomin" title="放大">🔍+</button>
        <button class="rm-tool-btn" data-action="zoomout" title="缩小">🔍-</button>
        <button class="rm-tool-btn" data-action="fit" title="适应窗口">🔲</button>
        <button class="rm-tool-btn" data-action="frame" title="分组(选中节点后点击)">📦</button>
        <button class="rm-tool-btn" data-action="roles" title="角色列表">🎭</button>
    `;
    div.appendChild(toolbar);

    // === 角色面板（嵌在路线图卡片内，默认隐藏） ===
    const rolePanel = document.createElement('div');
    rolePanel.className = 'rm-role-panel hidden';
    rolePanel.innerHTML = '<div class="rm-role-list"></div>';
    div.appendChild(rolePanel);

    // === 撤销/重做 + 自动保存 ===
    const 历史栈 = [];
    const 重做栈 = [];
    const HIST_MAX = 50;

    function 快照() {
        const frames = svgEl._getFrames ? svgEl._getFrames() : [];
        return JSON.stringify({节点: 路线图.节点||[], 连接: 路线图.连接||[], 描述: 路线图.描述||'', frames: frames});
    }
    function 恢复快照(snap) {
        const d = JSON.parse(snap);
        路线图.节点 = d.节点; 路线图.连接 = d.连接; 路线图.描述 = d.描述;
        if (d.frames && svgEl._setFrames) svgEl._setFrames(d.frames);
    }
    function 推入历史() {
        历史栈.push(快照());
        if (历史栈.length > HIST_MAX) 历史栈.shift();
        重做栈.length = 0;
        自动保存();
    }
    function 撤销() {
        if (历史栈.length === 0) return;
        重做栈.push(快照());
        恢复快照(历史栈.pop());
        svgEl._refresh();
    }
    function 重做() {
        if (重做栈.length === 0) return;
        历史栈.push(快照());
        恢复快照(重做栈.pop());
        svgEl._refresh();
    }
    function 自动保存() {
        try { localStorage.setItem('rm_autosave', JSON.stringify(路线图)); } catch(e) {}
    }
    function 重建SVG() {
        const newSVG = createInteractiveSVG(路线图);
        newSVG._onModify = 推入历史;
        newSVG._onEditNode = (n, render) => {
            showNodeEditor(n, (edited) => {
                n.名称 = edited.名称; n.图标 = edited.图标; n.类型 = edited.类型;
                if (edited.工具名 !== undefined) n.工具名 = edited.工具名;
                if (edited.工具参数 !== undefined) n.工具参数 = edited.工具参数;
                推入历史();
                render();
            });
        };
        newSVG._onContextMenu = (e, n, render) => {
            showNodeContextMenu(e.clientX, e.clientY, n, 路线图, render, () => {
                推入历史();
                重建SVG();
            }, newSVG);
        };
        svgEl.replaceWith(newSVG);
        svgEl = newSVG;
        自动保存();
    }

    // === 交互式SVG ===
    let svgEl = createInteractiveSVG(路线图);

    // SVG回调钩子
    svgEl._onModify = () => { 推入历史(); };
    svgEl._onUndo = () => { 撤销(); };
    svgEl._onRedo = () => { 重做(); };
    svgEl._onEditNode = (n, render) => {
        showNodeEditor(n, (edited) => {
            n.名称 = edited.名称; n.图标 = edited.图标; n.类型 = edited.类型;
            if (edited.工具名 !== undefined) n.工具名 = edited.工具名;
            if (edited.工具参数 !== undefined) n.工具参数 = edited.工具参数;
            推入历史();
            render();
        });
    };
    svgEl._onContextMenu = (e, n, render) => {
        showNodeContextMenu(e.clientX, e.clientY, n, 路线图, render, () => {
            推入历史();
            重建SVG();
        }, svgEl);
    };
    div.appendChild(svgEl);

    // 工具栏事件
    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.rm-tool-btn');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'add') {
            // 内联属性面板替代prompt
            showNodeEditor(null, (node) => {
                推入历史();
                路线图.节点 = 路线图.节点 || [];
                路线图.节点.push(node);
                svgEl._addNode(node);
            });
        } else if (action === 'undo') {
            撤销();
        } else if (action === 'redo') {
            重做();
        } else if (action === 'save') {
            // 内联保存面板
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.style.display = 'flex';
            overlay.innerHTML = `
                <div class="modal-box" style="max-width:360px">
                    <div class="modal-title">💾 保存路线图</div>
                    <input id="rm-save-name" value="${(路线图.描述||'').replace(/"/g,'&quot;')}" placeholder="路线图名称" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:8px 10px;color:#c8c8e0;font-size:14px;outline:none;margin-bottom:10px;">
                    <div class="modal-actions">
                        <button id="rm-save-cancel" class="modal-btn">取消</button>
                        <button id="rm-save-ok" class="modal-btn modal-btn-primary">保存</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const input = overlay.querySelector('#rm-save-name');
            input.focus(); input.select();
            overlay.querySelector('#rm-save-cancel').onclick = () => overlay.remove();
            overlay.querySelector('#rm-save-ok').onclick = () => {
                const name = input.value.trim();
                if (!name) return;
                fetch(API_BASE + '/api/roadmap/save', {method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({name, data: 路线图})})
                .then(r => r.json()).then(d => {
                    overlay.remove();
                    if (d.错误) log('系统', '❌ 保存失败: ' + d.错误);
                    else log('系统', '✅ 路线图已保存: ' + name);
                });
            };
            input.addEventListener('keydown', e => { if (e.key === 'Enter') overlay.querySelector('#rm-save-ok').click(); });
        } else if (action === 'load') {
            // 内联加载面板
            fetch(API_BASE + '/api/roadmap/list').then(r => r.json()).then(list => {
                if (!list || list.length === 0) { log('系统', '暂无已保存的路线图'); return; }
                const overlay = document.createElement('div');
                overlay.className = 'modal-overlay';
                overlay.style.display = 'flex';
                let itemsHtml = list.map(g => `<div class="rm-load-item" data-name="${g.name}" style="padding:8px 12px;cursor:pointer;border-radius:6px;transition:background 0.1s;font-size:13px;color:#c8c8e0;">📋 ${g.name}</div>`).join('');
                overlay.innerHTML = `
                    <div class="modal-box" style="max-width:360px">
                        <div class="modal-title">📂 加载路线图</div>
                        <div style="max-height:300px;overflow-y:auto;margin-bottom:10px">${itemsHtml}</div>
                        <div class="modal-actions">
                            <button id="rm-load-cancel" class="modal-btn">取消</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelectorAll('.rm-load-item').forEach(item => {
                    item.addEventListener('mouseenter', () => item.style.background = 'rgba(74,158,255,0.15)');
                    item.addEventListener('mouseleave', () => item.style.background = '');
                    item.addEventListener('click', () => {
                        const name = item.dataset.name;
                        fetch(API_BASE + '/api/roadmap/load', {method:'POST', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify({name})})
                        .then(r => r.json()).then(d => {
                            overlay.remove();
                            if (d.错误 || !d.data) { log('系统', '❌ 读取失败'); return; }
                            Object.assign(路线图, d.data);
                            重建SVG();
                            log('系统', '✅ 已加载: ' + name);
                        });
                    });
                });
                overlay.querySelector('#rm-load-cancel').onclick = () => overlay.remove();
            });
        } else if (action === 'zoomin') svgEl._zoomBy(0.8);
        else if (action === 'zoomout') svgEl._zoomBy(1.25);
        else if (action === 'fit') svgEl._fit();
        else if (action === 'frame') {
            // 分组：选中节点后创建frame
            if (selectedNodes.length === 0) { log('系统', '请先框选节点'); return; }
            svgEl._createFrame(selectedNodes);
        }
        else if (action === 'roles') {
            const isHidden = rolePanel.classList.contains('hidden');
            if (isHidden) {
                rolePanel.classList.remove('hidden');
                loadRolesIntoPanel(rolePanel.querySelector('.rm-role-list'), 路线图, () => { 推入历史(); 重建SVG(); });
            } else {
                rolePanel.classList.add('hidden');
            }
        }
    });

    // 按钮区
    const btnDiv = document.createElement('div');
    btnDiv.style.cssText = 'display:flex;gap:8px;margin-top:8px;align-items:center;';
    const execBtn = document.createElement('button');
    execBtn.textContent = '🚀 执行';
    execBtn.style.cssText = 'background:linear-gradient(135deg,#2a4a8a,#1a3a7a);border:none;border-radius:6px;padding:6px 16px;color:#e0e8ff;font-size:13px;cursor:pointer;font-family:inherit;transition:all 0.2s;';
    const modifyBtn = document.createElement('button');
    modifyBtn.textContent = '✏️ 修改';
    modifyBtn.style.cssText = 'background:#1a1a2e;border:1px solid #2a2a44;border-radius:6px;padding:6px 16px;color:#8888aa;font-size:13px;cursor:pointer;font-family:inherit;transition:all 0.2s;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'background:#1a1a2e;border:1px solid #2a2a44;border-radius:6px;padding:6px 16px;color:#8888aa;font-size:13px;cursor:pointer;font-family:inherit;';
    // 状态标签（执行中/已完成）
    const 状态标签 = document.createElement('span');
    状态标签.style.cssText = 'font-size:12px;color:#555577;margin-left:4px;transition:all 0.3s;';
    btnDiv.appendChild(execBtn);
    btnDiv.appendChild(modifyBtn);
    btnDiv.appendChild(cancelBtn);
    btnDiv.appendChild(状态标签);
    div.appendChild(btnDiv);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    let 已执行 = false;
    let 当前ID = 路线图ID;
    execBtn.onclick = () => {
        if (已执行) {
            // 再次执行——走独立API（_处理对话已结束）
            当前ID = Date.now().toString(36);
            log('系统', '🔄 路线图再次执行');
            execBtn.disabled = true;
            execBtn.textContent = '⏳ 执行中...';
            execBtn.style.opacity = '0.6';
            状态标签.textContent = '⏳ 执行中';
            状态标签.style.color = '#f39c12';
            当前路线图卡片 = { execBtn, 状态标签, cancelBtn };
            // 独立执行API——SSE流式
            fetch(API_BASE + '/api/execute-plan', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({路线图: 路线图, 用户消息: '', 对话ID: 当前对话ID})
            }).then(resp => {
                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                const pump = () => reader.read().then(({done, value}) => {
                    if (done) {
                        // 执行完成
                        execBtn.disabled = false;
                        execBtn.textContent = '🔄 再次执行';
                        execBtn.style.opacity = '1';
                        状态标签.textContent = '✅ 已完成';
                        状态标签.style.color = '#2ecc71';
                        当前路线图卡片 = null;
                        return;
                    }
                    buffer += decoder.decode(value, {stream:true});
                    const events = buffer.split('\n\n');
                    buffer = events.pop();
                    for (const event of events) {
                        if (!event.startsWith('data: ')) continue;
                        const data = JSON.parse(event.slice(6));
                        if (data.类型 === '激活' || data.类型 === '传播') {
                            // 推入事件队列走正常动画+音效
                            eventQueue.push(data);
                            processQueue();
                        } else if (data.类型 === '节点开始' || data.类型 === '节点完成') {
                            eventQueue.push(data);
                            processQueue();
                        } else if (data.类型 === '进度') {
                            const p = data.数据;
                            execBtn.textContent = `⏳ ${p.已完成}/${p.总数}`;
                        } else if (data.类型 === '路线图开始') {
                            路线图模式 = true;
                            eventQueue.push(data);
                            processQueue();
                        } else if (data.类型 === '路线图结束') {
                            路线图模式 = false;
                            eventQueue.push(data);
                            processQueue();
                        } else if (data.类型 === '路线图结果') {
                            const r = data.数据;
                            const msg = addMessage('assistant', '');
                            msg.innerHTML = `<strong style="color:#9b59b6">${r.图标 || '🔹'} ${r.ID}</strong><br>` + renderMarkdown(r.内容); enhanceCodeBlocks(msg);
                            msg.classList.add('msg-highlight');
                            messagesEl.scrollTop = messagesEl.scrollHeight;
                            播放音效(r.ID);
                        } else if (data.类型 === '流式回复') {
                            // 汇总节点流式输出——暂时忽略（结果已由路线图结果推送）
                        } else if (data.类型 === '完成') {
                            // 完成
                        }
                    }
                    pump();
                });
                pump();
            }).catch(e => {
                log('系统', '❌ 执行失败: ' + e.message);
                execBtn.disabled = false;
                execBtn.textContent = '🔄 再次执行';
                execBtn.style.opacity = '1';
            });
        } else {
            // 首次执行——走confirm-plan（_处理对话还在等待）
            已执行 = true;
            log('系统', '✅ 路线图已确认，开始执行');
            execBtn.disabled = true;
            execBtn.textContent = '⏳ 执行中...';
            execBtn.style.opacity = '0.6';
            状态标签.textContent = '⏳ 执行中';
            状态标签.style.color = '#f39c12';
            当前路线图卡片 = { execBtn, 状态标签, cancelBtn };
            fetch(API_BASE + '/api/confirm-plan', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({操作: '执行', ID: 当前ID})
            }).catch(() => {});
        }
    };
    cancelBtn.onclick = () => {
        div.style.opacity = '0.4';
        execBtn.disabled = true;
        execBtn.textContent = '已取消';
        cancelBtn.disabled = true;
        状态标签.textContent = '⏭️ 已取消';
        状态标签.style.color = '#666';
        log('系统', '⏭️ 路线图已取消');
        fetch(API_BASE + '/api/confirm-plan', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({操作: '取消', ID: 路线图ID})
        }).catch(() => {});
    };
    // 修改按钮——弹出输入框，用户输入修改意见，后端调LLM修改路线图
    modifyBtn.onclick = async () => {
        const 意见 = await showModifyPrompt();
        if (!意见) return;
        modifyBtn.disabled = true;
        modifyBtn.textContent = '⏳ 修改中...';
        modifyBtn.style.opacity = '0.6';
        log('系统', '✏️ 修改路线图: ' + 意见);
        try {
            const resp = await fetch(API_BASE + '/api/modify-plan', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({修改意见: 意见, 路线图: 路线图}),
            });
            const 数据 = await resp.json();
            if (数据.错误) {
                log('系统', '❌ 修改失败: ' + 数据.错误);
                modifyBtn.disabled = false;
                modifyBtn.textContent = '✏️ 修改';
                modifyBtn.style.opacity = '1';
                return;
            }
            if (数据.路线图) {
                // 更新闭包中的路线图引用（后续执行用新路线图）
                路线图 = 数据.路线图;
                // 更新描述
                desc.textContent = '📋 ' + (数据.路线图.描述 || '路线图预览');
                // 用重建SVG（包含回调钩子设置）
                重建SVG();
                log('系统', '✅ 路线图已修改');
            }
        } catch (e) {
            log('系统', '❌ 修改失败: ' + e.message);
        }
        modifyBtn.disabled = false;
        modifyBtn.textContent = '✏️ 修改';
        modifyBtn.style.opacity = '1';
    };
}

// 路线图修改输入弹窗
function showModifyPrompt() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal-box" style="max-width:500px">
                <div class="modal-title">✏️ 修改路线图</div>
                <div style="color:#aaaacc;margin-bottom:10px;font-size:13px;">你打算如何修改？</div>
                <textarea id="modify-input" rows="3" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:8px;padding:10px 14px;color:#c8c8e0;font-size:14px;font-family:inherit;outline:none;resize:vertical;" placeholder="例如：把第二个角色换成小红，再加一个总结步骤..." autofocus></textarea>
                <div class="modal-actions" style="margin-top:12px;">
                    <button id="modify-cancel" class="modal-btn">取消</button>
                    <button id="modify-ok" class="modal-btn modal-btn-primary">确认修改</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#modify-input');
        input.focus();
        const close = (val) => { overlay.remove(); resolve(val); };
        overlay.querySelector('#modify-cancel').onclick = () => close(null);
        overlay.querySelector('#modify-ok').onclick = () => close(input.value.trim());
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); close(input.value.trim()); }
            if (e.key === 'Escape') close(null);
        });
    });
}

// === 交互式路线图SVG（缩放/平移/拖拽/连线/编辑） ===
function createInteractiveSVG(路线图) {
    const SVGNS = 'http://www.w3.org/2000/svg';
    const 类型色 = {角色:'#9b59b6', 汇总:'#f39c12', 处理:'#4a9eff', 总结:'#2ecc71', 起点:'#4a9eff', 工具:'#e67e22'};
    const 节点宽 = 100, 节点高 = 40, 层间距 = 80, 节点间距 = 140;

    const 节点 = 路线图.节点 || [];
    let 连接 = 路线图.连接 || [];

    // 补充"起点"虚拟节点
    const 节点IDs = new Set(节点.map(n => n.id || n.名称));
    const 补充节点 = [];
    连接.forEach(c => {
        if (c.from && !节点IDs.has(c.from)) { 补充节点.push({id:c.from, 名称:c.from, 图标:'🎬', 类型:'起点'}); 节点IDs.add(c.from); }
        if (c.to && !节点IDs.has(c.to)) { 补充节点.push({id:c.to, 名称:c.to, 图标:'⚪', 类型:'处理'}); 节点IDs.add(c.to); }
    });
    const 全部节点 = [...补充节点, ...节点];

    // 拓扑分层
    const 位置 = {};
    const 所有目标 = new Set(连接.map(c => c.to));
    let 当前层 = 全部节点.filter(n => !所有目标.has(n.id || n.名称));
    if (当前层.length === 0) 当前层 = 全部节点;
    let 已布局 = new Set(), 层号 = 0;
    while (当前层.length > 0) {
        const 层宽度 = (当前层.length - 1) * 节点间距;
        当前层.forEach((n, i) => {
            const nid = n.id || n.名称;
            位置[nid] = { x: 300 - 层宽度/2 + i * 节点间距, y: 20 + 层号 * 层间距, 节点: n };
            已布局.add(nid);
        });
        const 下一层 = [];
        当前层.forEach(n => {
            const nid = n.id || n.名称;
            连接.forEach(c => {
                if (c.from === nid) {
                    const 目标 = 全部节点.find(nn => (nn.id||nn.名称) === c.to);
                    if (目标 && !已布局.has(c.to) && !下一层.includes(目标)) 下一层.push(目标);
                }
            });
        });
        当前层 = 下一层; 层号++;
    }
    全部节点.forEach(n => {
        const nid = n.id || n.名称;
        if (!位置[nid]) { 位置[nid] = { x: 300, y: 20 + 层号 * 层间距, 节点: n }; 层号++; }
    });

    // 根据节点实际范围计算SVG宽高，消除右侧空余
    const allX = Object.values(位置).map(p => p.x);
    const allY = Object.values(位置).map(p => p.y);
    const minX = allX.length ? Math.min(...allX) - 节点宽/2 - 20 : 0;
    const maxX = allX.length ? Math.max(...allX) + 节点宽/2 + 20 : 600;
    const minY = allY.length ? Math.min(...allY) - 10 : 0;
    const maxY = allY.length ? Math.max(...allY) + 节点高 + 10 : 150;
    const svgW = Math.max(300, maxX - minX);
    const svgH = Math.max(120, maxY - minY);
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(Math.min(svgH + 100, 500)));
    svg.setAttribute('viewBox', `${minX} ${minY} ${svgW} ${svgH}`);
    svg.style.cssText = 'background:#080812;border-radius:6px;user-select:none;display:block;';
    svg.classList.add('rm-svg');

    // defs marker
    const defs = document.createElementNS(SVGNS, 'defs');
    const markerId = 'arrow' + Date.now() + Math.random().toString(36).slice(2,6);
    defs.innerHTML = `<marker id="${markerId}" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L8,5 L0,10 L2,5 Z" fill="#4a6aaa"/></marker>`;
    svg.appendChild(defs);

    const connsLayer = document.createElementNS(SVGNS, 'g');
    const nodesLayer = document.createElementNS(SVGNS, 'g');
    const tempLayer = document.createElementNS(SVGNS, 'g');
    svg.appendChild(connsLayer); svg.appendChild(nodesLayer); svg.appendChild(tempLayer);

    // 坐标转换: 屏幕坐标→SVG坐标
    function svgPoint(e) {
        const rect = svg.getBoundingClientRect();
        const vb = svg.viewBox.baseVal;
        return { x: (e.clientX - rect.left) / rect.width * vb.width + vb.x,
                 y: (e.clientY - rect.top) / rect.height * vb.height + vb.y };
    }

    // 渲染连线
    function renderConns() {
        connsLayer.innerHTML = '';
        连接.forEach(c => {
            const from = 位置[c.from], to = 位置[c.to];
            if (!from || !to) return;
            const x1 = from.x, y1 = from.y + 节点高;
            const x2 = to.x, y2 = to.y;
            const midY = (y1 + y2) / 2;
            // disabled节点连线样式
            const fromDisabled = from.节点 && from.节点.disabled;
            const toDisabled = to.节点 && to.节点.disabled;
            const isDisabled = fromDisabled || toDisabled;
            // 粗透明路径(点击用)
            const hit = document.createElementNS(SVGNS, 'path');
            hit.setAttribute('d', `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`);
            hit.setAttribute('stroke', 'transparent');
            hit.setAttribute('stroke-width', '12');
            hit.setAttribute('fill', 'none');
            hit.style.cursor = 'pointer';
            // 单击删除连线
            hit.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = 连接.indexOf(c);
                if (idx >= 0) 连接.splice(idx, 1);
                路线图.连接 = 连接;
                renderConns();
                if (svg._onModify) svg._onModify();
            });
            // 双击交换连线方向
            hit.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const idx = 连接.indexOf(c);
                if (idx >= 0) {
                    连接[idx] = {from: c.to, to: c.from};
                    路线图.连接 = 连接;
                    renderConns();
                    if (svg._onModify) svg._onModify();
                    showToastInSVG('已交换连线方向');
                }
            });
            hit.dataset.connId = c.from + '→' + c.to;
            connsLayer.appendChild(hit);
            // 可见路径
            const path = document.createElementNS(SVGNS, 'path');
            path.setAttribute('d', `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`);
            if (isDisabled) {
                path.setAttribute('stroke', '#444');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('stroke-dasharray', '4 3');
                path.setAttribute('opacity', '0.4');
            } else {
                path.setAttribute('stroke', '#3a4a7a');
                path.setAttribute('stroke-width', '2');
            }
            path.setAttribute('fill', 'none');
            path.setAttribute('marker-end', `url(#${markerId})`);
            path.style.pointerEvents = 'none';
            connsLayer.appendChild(path);
        });
    }

    // 渲染节点
    function renderNodes() {
        nodesLayer.innerHTML = '';
        Object.values(位置).forEach(p => {
            const n = p.节点;
            const 色 = 类型色[n.类型] || '#666';
            const x = p.x - 节点宽/2, y = p.y;
            const g = document.createElementNS(SVGNS, 'g');
            g.setAttribute('transform', `translate(${x},${y})`);
            g.style.cursor = 'move';
            g.dataset.nodeId = n.id || n.名称;
            // 矩形
            const rect = document.createElementNS(SVGNS, 'rect');
            rect.setAttribute('width', 节点宽); rect.setAttribute('height', 节点高);
            rect.setAttribute('rx', 8); rect.setAttribute('fill', 色 + '22');
            rect.setAttribute('stroke', 色); rect.setAttribute('stroke-width', '1.5');
            g.appendChild(rect);
            // 图标
            const iconT = document.createElementNS(SVGNS, 'text');
            iconT.setAttribute('x', 14); iconT.setAttribute('y', 26);
            iconT.setAttribute('text-anchor', 'middle'); iconT.setAttribute('font-size', '14');
            iconT.textContent = n.图标 || '⚪';
            g.appendChild(iconT);
            // 名称
            const nameT = document.createElementNS(SVGNS, 'text');
            nameT.setAttribute('x', 55); nameT.setAttribute('y', 22);
            nameT.setAttribute('text-anchor', 'middle'); nameT.setAttribute('font-size', '11');
            nameT.setAttribute('fill', '#c8c8e0');
            const dn = n.名称 && n.名称.length > 7 ? n.名称.substring(0,6)+'…' : (n.名称 || '');
            nameT.textContent = dn;
            g.appendChild(nameT);
            // 类型
            if (n.类型) {
                const typeT = document.createElementNS(SVGNS, 'text');
                typeT.setAttribute('x', 55); typeT.setAttribute('y', 35);
                typeT.setAttribute('text-anchor', 'middle'); typeT.setAttribute('font-size', '9');
                typeT.setAttribute('fill', 色);
                typeT.textContent = n.类型;
                g.appendChild(typeT);
            }
            // 输入端口(顶部小圆)
            const nid = n.id || n.名称;
            const hasInputConn = 连接.some(c => c.to === nid);
            const inPort = document.createElementNS(SVGNS, 'circle');
            inPort.setAttribute('cx', 节点宽/2); inPort.setAttribute('cy', 0);
            inPort.setAttribute('r', 5); inPort.setAttribute('fill', hasInputConn ? '#2ecc71' : '#1a3a2a');
            inPort.setAttribute('stroke', '#2ecc71'); inPort.setAttribute('stroke-width', hasInputConn ? '2' : '1.5');
            inPort.setAttribute('opacity', hasInputConn ? '1' : '0.5'); inPort.style.cursor = 'pointer';
            inPort.dataset.port = 'in'; inPort.dataset.node = nid;
            inPort.style.cursor = 'crosshair';
            // 输入端口也支持反向连线拖出
            inPort.addEventListener('mousedown', (e) => {
                e.stopPropagation(); e.preventDefault();
                connectState = {from: n, reverse: true};
                const nid = n.id || n.名称;
                if (selectedNodes.length > 1 && selectedNodes.includes(nid)) {
                    connectFromList = selectedNodes.slice();
                } else {
                    connectFromList = [nid];
                }
            });
            g.appendChild(inPort);
            // 输出端口(底部小圆)
            const hasOutputConn = 连接.some(c => c.from === nid);
            const outPort = document.createElementNS(SVGNS, 'circle');
            outPort.setAttribute('cx', 节点宽/2); outPort.setAttribute('cy', 节点高);
            outPort.setAttribute('r', 5); outPort.setAttribute('fill', hasOutputConn ? '#f39c12' : '#3a2a1a');
            outPort.setAttribute('stroke', '#f39c12'); outPort.setAttribute('stroke-width', hasOutputConn ? '2' : '1.5');
            outPort.setAttribute('opacity', hasOutputConn ? '1' : '0.5'); outPort.style.cursor = 'crosshair';
            outPort.dataset.port = 'out'; outPort.dataset.node = nid;
            outPort.addEventListener('mousedown', (e) => {
                e.stopPropagation(); e.preventDefault();
                connectState = {from: n};
                const nid = n.id || n.名称;
                // 批量连线：多选时所有选中节点都参与
                if (selectedNodes.length > 1 && selectedNodes.includes(nid)) {
                    connectFromList = selectedNodes.slice();
                } else {
                    connectFromList = [nid];
                }
            });
            g.appendChild(outPort);
            // 拖拽（不在端口上才拖节点）
            g.addEventListener('mousedown', (e) => {
                if (e.target === inPort || e.target === outPort) return;
                if (e.button !== 0) return;  // 只处理左键，中键不拖拽
                e.stopPropagation();
                const nid = n.id || n.名称;
                // Shift+拖拽 = 快速复制节点
                if (e.shiftKey) {
                    e.preventDefault();
                    // 计算鼠标相对于原节点的偏移量（复制后保持这个偏移）
                    const pt0 = svgPoint(e);
                    const grabOffsetX = pt0.x - 位置[nid].x;
                    const grabOffsetY = pt0.y - 位置[nid].y;
                    // 复制当前节点（含选中节点+它们之间的连线）
                    const idsToCopy = selectedNodes.length > 1 && selectedNodes.includes(nid) ? selectedNodes.slice() : [nid];
                    const idMap = {};
                    const newIds = [];
                    for (const oldId of idsToCopy) {
                        const src = 位置[oldId];
                        if (!src) continue;
                        const srcNode = src.节点;
                        const newId = 'n' + Date.now() + Math.random().toString(36).slice(2, 6);
                        idMap[oldId] = newId;
                        const newNode = JSON.parse(JSON.stringify(srcNode));
                        newNode.id = newId;
                        路线图.节点 = 路线图.节点 || [];
                        路线图.节点.push(newNode);
                        // 副本位置=原位置（拖拽时跟随鼠标偏移）
                        位置[newId] = { x: src.x, y: src.y, 节点: newNode };
                        newIds.push(newId);
                    }
                    // 复制选中节点之间的连线
                    const oldConns = 连接.filter(c => idsToCopy.includes(c.from) && idsToCopy.includes(c.to));
                    for (const c of oldConns) {
                        const nf = idMap[c.from], nt = idMap[c.to];
                        if (nf && nt && !连接.find(x => x.from === nf && x.to === nt)) {
                            连接.push({ from: nf, to: nt });
                        }
                    }
                    路线图.连接 = 连接;
                    selectedNodes = newIds;
                    renderNodes();
                    renderConns();
                    updateSelection();
                    if (svg._onModify) svg._onModify();
                    // 开始拖拽复制出来的主节点
                    const mainId = idMap[nid] || newIds[0];
                    const mainPos = 位置[mainId];
                    if (mainPos) {
                        const mainG = nodesLayer.querySelector(`g[data-node-id="${mainId}"]`);
                        // ox/oy = 节点当前位置，sx/sy = 鼠标当前位置
                        // 拖拽时 newX = ox + (pt.x - sx)，节点跟随鼠标且保持初始抓取偏移
                        dragState = { node: mainPos.节点, g: mainG, sx: pt0.x, sy: pt0.y, ox: mainPos.x, oy: mainPos.y, lastX: pt0.x, lastY: pt0.y };
                    }
                    return;
                }
                // 选择逻辑：Ctrl加选 / Alt减选 / 普通替换
                if (e.altKey) {
                    selectedNodes = selectedNodes.filter(id => id !== nid);
                } else if (e.ctrlKey) {
                    if (!selectedNodes.includes(nid)) selectedNodes.push(nid);
                } else if (!selectedNodes.includes(nid)) {
                    selectedNodes = [nid];
                }
                updateSelection();
                // 开始拖拽
                const pt = svgPoint(e);
                dragState = { node: n, g, sx: pt.x, sy: pt.y, ox: 位置[nid].x, oy: 位置[nid].y, lastX: pt.x, lastY: pt.y };
            });
            // 双击编辑——用内联面板替代prompt
            g.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (svg._onEditNode) svg._onEditNode(n, () => { renderNodes(); renderConns(); });
            });
            // 右键菜单
            g.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (svg._onContextMenu) svg._onContextMenu(e, n, () => { renderNodes(); renderConns(); });
            });
            nodesLayer.appendChild(g);
        });
    }

    let dragState = null, connectState = null, panState = null;
    let selectedNodes = [];      // 多选节点列表
    let boxSelect = null;        // 框选状态 {sx, sy, ctrl, alt}
    let connectFromList = [];    // 批量连线源节点列表
    let clipboard = [];          // 复制粘贴剪贴板 [{node, x, y}, ...]
    let frames = [];             // 分组列表
    let frameIdCounter = 0;
    let dragFrame = null;        // 拖拽中的分组
    const FRAME_COLORS = ['#CE9178','#4EC9B0','#DCDCAA','#9CDCFE','#C586C0','#F44747','#61AFEF','#98C379'];

    // 渲染分组（SVG层，在节点和连线之下）
    let framesLayer = svg.querySelector('#framesLayer');
    if (!framesLayer) {
        framesLayer = document.createElementNS(SVGNS, 'g');
        framesLayer.setAttribute('id', 'framesLayer');
        svg.insertBefore(framesLayer, svg.firstChild.nextSibling); // defs之后
    }
    function renderFrames() {
        framesLayer.innerHTML = '';
        for (const f of frames) {
            const g = document.createElementNS(SVGNS, 'g');
            g.dataset.frameId = f.id;
            g.style.cursor = 'move';
            const rect = document.createElementNS(SVGNS, 'rect');
            rect.setAttribute('x', f.x); rect.setAttribute('y', f.y);
            rect.setAttribute('width', f.w); rect.setAttribute('height', f.h);
            rect.setAttribute('rx', 6);
            rect.setAttribute('fill', f.color + '15');
            rect.setAttribute('stroke', f.color);
            rect.setAttribute('stroke-width', '1.5');
            rect.setAttribute('stroke-dasharray', '6 3');
            g.appendChild(rect);
            // 标题
            const text = document.createElementNS(SVGNS, 'text');
            text.setAttribute('x', f.x + 8); text.setAttribute('y', f.y + 16);
            text.setAttribute('font-size', '11'); text.setAttribute('fill', f.color);
            text.textContent = '📦 ' + f.text + ' (' + (f.nodeIds||[]).length + ')';
            g.appendChild(text);
            // 拖拽
            g.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                const pt = svgPoint(e);
                dragFrame = {id: f.id, lastX: pt.x, lastY: pt.y, startY: e.clientY, moved: false};
            });
            // 双击重命名
            g.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const name = prompt('分组名称:', f.text);
                if (name !== null) { f.text = name.trim() || '分组'; renderFrames(); if (svg._onModify) svg._onModify(); }
            });
            // 右键解除分组
            g.addEventListener('contextmenu', (e) => {
                e.preventDefault(); e.stopPropagation();
                // 解除分组：从frames中移除，节点不动
                frames = frames.filter(ff => ff.id !== f.id);
                renderFrames();
                if (svg._onModify) svg._onModify();
                showToastInSVG('已解除分组: ' + f.text);
            });
            framesLayer.appendChild(g);
        }
    }

    // 选中样式更新
    function updateSelection() {
        nodesLayer.querySelectorAll('g[data-node-id]').forEach(g => {
            const nid = g.dataset.nodeId;
            const rect = g.querySelector('rect');
            if (rect) {
                if (selectedNodes.includes(nid)) {
                    rect.setAttribute('stroke-width', '3');
                    rect.setAttribute('filter', 'brightness(1.3)');
                } else {
                    rect.setAttribute('stroke-width', '1.5');
                    rect.removeAttribute('filter');
                }
            }
        });
    }

    // SVG空白双击 → 弹出节点商店
    svg.addEventListener('dblclick', (e) => {
        const onNode = e.target.closest('g[data-node-id]');
        if (onNode) return;  // 节点双击由节点自己处理
        e.preventDefault(); e.stopPropagation();
        showNodeShopMenu(e.clientX, e.clientY);
    });

    // === 节点商店 ===
    const 节点商店 = {
        "基础节点": {
            icon: "📦",
            items: [
                {name: "📝 文本输入", 类型: "处理", 图标: "📝", config: {提示词: "你是文本处理助手。请处理上游内容。"}},
                {name: "🎭 角色(LLM)", 类型: "角色", 图标: "🎭", config: {提示词: ""}},
                {name: "📊 汇总", 类型: "汇总", 图标: "📊", config: {提示词: ""}},
                {name: "📝 总结", 类型: "总结", 图标: "📝", config: {提示词: ""}},
            ]
        },
        "文件操作": {
            icon: "📁",
            items: [
                {name: "📄 读取文件", 类型: "工具", 图标: "📄", 工具名: "read_file", 工具参数: {path: ""}},
                {name: "✏️ 写入文件", 类型: "工具", 图标: "✏️", 工具名: "write_file", 工具参数: {path: "", content: ""}},
                {name: "📄 创建文件", 类型: "工具", 图标: "📄", 工具名: "create_file", 工具参数: {path: "", content: ""}},
                {name: "📋 列出目录", 类型: "工具", 图标: "📋", 工具名: "list_dir", 工具参数: {path: "."}},
                {name: "🌲 目录树", 类型: "工具", 图标: "🌲", 工具名: "tree_dir", 工具参数: {path: ".", depth: 3}},
                {name: "🔎 搜索代码", 类型: "工具", 图标: "🔎", 工具名: "search_code", 工具参数: {keyword: "", path: "."}},
            ]
        },
        "文件分析": {
            icon: "📊",
            items: [
                {name: "📊 文件信息", 类型: "工具", 图标: "📊", 工具名: "file_info", 工具参数: {path: ""}},
                {name: "📏 统计行数", 类型: "工具", 图标: "📏", 工具名: "count_lines", 工具参数: {path: ""}},
                {name: "📖 读头部N行", 类型: "工具", 图标: "📖", 工具名: "read_head", 工具参数: {path: "", lines: 20}},
                {name: "📖 读尾部N行", 类型: "工具", 图标: "📖", 工具名: "read_tail", 工具参数: {path: "", lines: 20}},
                {name: "📖 读指定行", 类型: "工具", 图标: "📖", 工具名: "read_lines", 工具参数: {path: "", start: 1, end: 10}},
                {name: "🔎 搜索行", 类型: "工具", 图标: "🔎", 工具名: "search_lines", 工具参数: {path: "", keyword: "", context: 0}},
                {name: "🔄 比较文件", 类型: "工具", 图标: "🔄", 工具名: "diff_files", 工具参数: {path1: "", path2: ""}},
                {name: "# 文件哈希", 类型: "工具", 图标: "#", 工具名: "file_hash", 工具参数: {path: "", algo: "md5"}},
            ]
        },
        "系统操作": {
            icon: "💻",
            items: [
                {name: "💻 运行命令", 类型: "工具", 图标: "💻", 工具名: "run_command", 工具参数: {command: "", workdir: ""}},
                {name: "🕐 获取时间", 类型: "工具", 图标: "🕐", 工具名: "get_time", 工具参数: {}},
            ]
        },
    };

    function showNodeShopMenu(mouseX, mouseY) {
        // 关闭旧菜单
        const old = document.querySelector('.rm-node-shop');
        if (old) old.remove();

        const menu = document.createElement('div');
        menu.className = 'rm-node-shop';
        menu.style.cssText = `position:fixed;left:${Math.min(mouseX, window.innerWidth-220)}px;top:${Math.min(mouseY, window.innerHeight-300)}px;z-index:10000;background:#12121e;border:1px solid #2a2a44;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);min-width:200px;max-height:400px;overflow-y:auto;font-size:13px;color:#c8c8e0`;

        let html = '<div style="padding:6px 10px;border-bottom:1px solid #2a2a44"><input type="text" id="rmShopSearch" placeholder="🔍 搜索节点..." style="width:100%;background:#0a0a14;border:1px solid #2a2a44;border-radius:4px;padding:4px 8px;color:#c8c8e0;font-size:12px;outline:none"></div>';

        for (const catName in 节点商店) {
            const cat = 节点商店[catName];
            html += `<div class="rm-shop-cat" data-cat="${catName}" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid #1a1a2e">`;
            html += `<span style="margin-right:6px">${cat.icon}</span><span>${catName}</span><span style="float:right;color:#555">▶</span>`;
            html += `<div class="rm-shop-sub" style="display:none;padding:4px 0 4px 16px">`;
            cat.items.forEach(item => {
                const searchData = (catName + ' ' + item.name).toLowerCase();
                html += `<div class="rm-shop-item" data-search="${searchData}" style="padding:4px 10px;cursor:pointer;border-radius:4px;font-size:12px" data-item='${JSON.stringify(item).replace(/'/g, "&#39;")}'>${item.name}</div>`;
            });
            html += `</div></div>`;
        }

        menu.innerHTML = html;
        document.body.appendChild(menu);

        // 分类展开/折叠
        menu.querySelectorAll('.rm-shop-cat').forEach(catEl => {
            catEl.addEventListener('click', (e) => {
                if (e.target.classList.contains('rm-shop-item')) return;
                const sub = catEl.querySelector('.rm-shop-sub');
                if (sub) {
                    const isHidden = sub.style.display === 'none';
                    sub.style.display = isHidden ? 'block' : 'none';
                    catEl.querySelector('span:last-child').textContent = isHidden ? '▼' : '▶';
                }
            });
        });

        // 节点点击 → 添加到画布
        menu.querySelectorAll('.rm-shop-item').forEach(itemEl => {
            itemEl.addEventListener('mouseenter', () => { itemEl.style.background = 'rgba(74,158,255,0.15)'; });
            itemEl.addEventListener('mouseleave', () => { itemEl.style.background = ''; });
            itemEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = JSON.parse(itemEl.dataset.item);
                const newNode = {
                    id: 'n' + Date.now() + Math.random().toString(36).slice(2,6),
                    名称: item.name.replace(/^[^\s]+\s/, ''),
                    图标: item.图标,
                    类型: item.类型,
                };
                if (item.工具名) { newNode.工具名 = item.工具名; newNode.工具参数 = item.工具参数 || {}; }
                if (item.config) newNode.config = item.config;
                路线图.节点 = 路线图.节点 || [];
                路线图.节点.push(newNode);
                svg._addNode(newNode);
                renderConns();
                if (svg._onModify) svg._onModify();
                menu.remove();
            });
        });

        // 搜索过滤
        const search = menu.querySelector('#rmShopSearch');
        search.focus();
        search.addEventListener('input', () => {
            const q = search.value.toLowerCase();
            menu.querySelectorAll('.rm-shop-item').forEach(el => {
                const match = el.dataset.search.includes(q);
                el.style.display = match ? '' : 'none';
            });
            // 自动展开有匹配项的分类
            menu.querySelectorAll('.rm-shop-cat').forEach(catEl => {
                const sub = catEl.querySelector('.rm-shop-sub');
                const hasVisible = Array.from(sub.querySelectorAll('.rm-shop-item')).some(el => el.style.display !== 'none');
                if (q && hasVisible) {
                    sub.style.display = 'block';
                    catEl.querySelector('span:last-child').textContent = '▼';
                } else if (!q) {
                    sub.style.display = 'none';
                    catEl.querySelector('span:last-child').textContent = '▶';
                }
            });
        });

        // 点击外部关闭
        const closeHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('mousedown', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 0);
    }

    // SVG空白mousedown → 框选（仅左键，剪刀模式下不框选）
    svg.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (scissorsMode) return;  // 剪刀模式下不触发框选
        // 如果点击的不是节点也不是端口 → 框选
        const onNode = e.target.closest('g[data-node-id]');
        const tag = (e.target.tagName || '').toLowerCase();
        const onPort = tag === 'circle' && e.target.dataset && e.target.dataset.port;
        if (onNode || onPort) return;

        // 清除连线状态
        if (connectState) {
            connectState = null; connectFromList = [];
            tempLayer.innerHTML = '';
            return;
        }

        if (!e.ctrlKey && !e.altKey) {
            selectedNodes = [];
            updateSelection();
        }
        const pt = svgPoint(e);
        boxSelect = {sx: pt.x, sy: pt.y, ctrl: e.ctrlKey, alt: e.altKey};
        // 创建框选矩形
        let selRect = tempLayer.querySelector('.box-sel');
        if (!selRect) {
            selRect = document.createElementNS(SVGNS, 'rect');
            selRect.setAttribute('class', 'box-sel');
            selRect.setAttribute('fill', 'rgba(74,158,255,0.08)');
            selRect.setAttribute('stroke', '#4a9eff');
            selRect.setAttribute('stroke-width', '1');
            selRect.setAttribute('stroke-dasharray', '4 4');
            tempLayer.appendChild(selRect);
        }
        selRect.setAttribute('x', pt.x); selRect.setAttribute('y', pt.y);
        selRect.setAttribute('width', '0'); selRect.setAttribute('height', '0');
    });

    svg.addEventListener('mousemove', (e) => {
        const pt = svgPoint(e);
        // 拖拽节点（多选时一起移动）
        if (dragState) {
            const nid = dragState.node.id || dragState.node.名称;
            const newX = dragState.ox + (pt.x - dragState.sx);
            const newY = dragState.oy + (pt.y - dragState.sy);
            位置[nid].x = newX;
            位置[nid].y = newY;
            dragState.g.setAttribute('transform', `translate(${newX - 节点宽/2},${newY})`);
            // 多选节点一起移动
            if (selectedNodes.length > 1) {
                const dx = pt.x - dragState.lastX;
                const dy = pt.y - dragState.lastY;
                selectedNodes.forEach(sid => {
                    if (sid === nid) return;
                    const sn = 位置[sid];
                    if (sn) { sn.x += dx; sn.y += dy;
                        const sg = nodesLayer.querySelector(`g[data-node-id="${sid}"]`);
                        if (sg) sg.setAttribute('transform', `translate(${sn.x - 节点宽/2},${sn.y})`);
                    }
                });
            }
            dragState.lastX = pt.x;
            dragState.lastY = pt.y;
            renderConns();
        }
        // 拖拽连线（支持批量：从connectFromList所有节点画临时线）
        if (connectState) {
            tempLayer.innerHTML = '';
            const isReverse = connectState.reverse;
            const nodesToDraw = connectFromList.length > 0 ? connectFromList : [connectState.from.id || connectState.from.名称];
            nodesToDraw.forEach(fromId => {
                const from = 位置[fromId];
                if (!from) return;
                // 反向连线从顶部输入端口拉出，正向从底部输出端口拉出
                const x1 = from.x, y1 = isReverse ? from.y : from.y + 节点高;
                const dx = Math.abs(pt.x - x1) * 0.5;
                const path = document.createElementNS(SVGNS, 'path');
                path.setAttribute('d', `M${x1},${y1} C${x1+dx},${y1} ${pt.x-dx},${pt.y} ${pt.x},${pt.y}`);
                path.setAttribute('stroke', isReverse ? '#2ecc71' : '#f39c12');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-dasharray', '4 4');
                path.setAttribute('fill', 'none');
                path.setAttribute('opacity', '0.6');
                tempLayer.appendChild(path);
            });
            // 高亮目标节点
            const target = e.target.closest('g[data-node-id]');
            nodesLayer.querySelectorAll('g[data-node-id]').forEach(g => {
                const r = g.querySelector('rect');
                if (r && target && g === target) {
                    r.setAttribute('stroke-width', '3');
                } else if (r && !selectedNodes.includes(g.dataset.nodeId)) {
                    r.setAttribute('stroke-width', '1.5');
                }
            });
        }
        // 框选拖拽
        if (boxSelect) {
            const x1 = Math.min(boxSelect.sx, pt.x);
            const y1 = Math.min(boxSelect.sy, pt.y);
            const w = Math.abs(pt.x - boxSelect.sx);
            const h = Math.abs(pt.y - boxSelect.sy);
            let selRect = tempLayer.querySelector('.box-sel');
            if (selRect) {
                selRect.setAttribute('x', x1);
                selRect.setAttribute('y', y1);
                selRect.setAttribute('width', w);
                selRect.setAttribute('height', h);
            }
        }
        // 拖拽分组（移动frame+内部所有节点，上下拖拽排序）
        if (dragFrame) {
            const dx = pt.x - dragFrame.lastX;
            const dy = pt.y - dragFrame.lastY;
            const f = frames.find(ff => ff.id === dragFrame.id);
            if (f) {
                if (Math.abs(e.clientY - dragFrame.startY) > 5) dragFrame.moved = true;
                f.x += dx; f.y += dy;
                // 移动内部节点
                (f.nodeIds || []).forEach(nid => {
                    const p = 位置[nid];
                    if (p) { p.x += dx; p.y += dy; }
                });
                // 上下拖拽排序：按Y重排frames数组顺序（影响渲染层级）
                if (dragFrame.moved) {
                    frames.sort((a, b) => a.y - b.y);
                }
                renderNodes();
                renderConns();
                renderFrames();
            }
            dragFrame.lastX = pt.x; dragFrame.lastY = pt.y;
        }
        // 中键平移
        if (panState) {
            const rect = svg.getBoundingClientRect();
            const vb = svg.viewBox.baseVal;
            vb.x = panState.vbX - (e.clientX - panState.sx) / rect.width * vb.width;
            vb.y = panState.vbY - (e.clientY - panState.sy) / rect.height * vb.height;
        }
    });

    svg.addEventListener('mouseup', (e) => {
        // 拖拽连线完成——清除临时线后用elementFromPoint找目标节点
        if (connectState) {
            tempLayer.innerHTML = '';  // 先清除临时线，避免阻挡
            // 临时禁用所有SVG子元素的pointer-events，让elementFromPoint能穿透到目标节点
            const oldPEs = [];
            svg.querySelectorAll('*').forEach((el, i) => {
                oldPEs[i] = el.style.pointerEvents;
                el.style.pointerEvents = 'none';
            });
            const under = document.elementFromPoint(e.clientX, e.clientY);
            svg.querySelectorAll('*').forEach((el, i) => {
                el.style.pointerEvents = oldPEs[i];
            });
            // 找到目标节点ID
            let toId = null;
            if (under) {
                // 先检查是否在端口上（SVG circle的tagName是小写）
                const tag = (under.tagName || '').toLowerCase();
                if (tag === 'circle' && under.dataset && under.dataset.port) {
                    toId = under.dataset.node;
                } else {
                    // 向上遍历DOM找g[data-node-id]
                    let el = under;
                    while (el && el !== svg && el !== document.body) {
                        if ((el.tagName || '').toLowerCase() === 'g' && el.dataset && el.dataset.nodeId) {
                            toId = el.dataset.nodeId;
                            break;
                        }
                        el = el.parentElement;
                    }
                }
            }
            // 方向由拖出端口决定，不管落点位置：
            // 从底部输出端口拖出(正向) → 源→目标 (连到目标顶部输入)
            // 从顶部输入端口拖出(反向) → 目标→源 (连到目标底部输出)
            const isReverse = connectState.reverse;
            if (toId) {
                const nodesToConnect = connectFromList.length > 0 ? connectFromList : [connectState.from.id || connectState.from.名称];
                let added = false;
                nodesToConnect.forEach(fromId => {
                    if (!fromId || fromId === toId) return;
                    const f = isReverse ? toId : fromId;
                    const t = isReverse ? fromId : toId;
                    if (!连接.find(c => c.from === f && c.to === t)) {
                        连接.push({ from: f, to: t });
                        added = true;
                    }
                });
                if (added) {
                    路线图.连接 = 连接;
                    renderConns();
                    if (svg._onModify) svg._onModify();
                }
            }
            tempLayer.innerHTML = '';
            connectState = null;
            connectFromList = [];
        }
        // 拖拽完成——网格对齐
        if (dragState) {
            const sn = 位置[dragState.node];
            if (sn) {
                const p = 对齐到网格(sn.x, sn.y);
                sn.x = p.x; sn.y = p.y;
                const sg = nodesLayer.querySelector(`g[data-node-id="${dragState.node}"]`);
                if (sg) sg.setAttribute('transform', `translate(${p.x - 节点宽/2},${p.y})`);
                renderConns();
            }
            // 多选拖拽也对齐
            if (selectedNodes.length > 1) {
                selectedNodes.forEach(sid => {
                    const sn2 = 位置[sid];
                    if (sn2) {
                        const p2 = 对齐到网格(sn2.x, sn2.y);
                        sn2.x = p2.x; sn2.y = p2.y;
                        const sg2 = nodesLayer.querySelector(`g[data-node-id="${sid}"]`);
                        if (sg2) sg2.setAttribute('transform', `translate(${p2.x - 节点宽/2},${p2.y})`);
                    }
                });
                renderConns();
            }
            if (svg._onModify) svg._onModify();
        }
        if (dragFrame && svg._onModify) svg._onModify();
        dragFrame = null;
        dragState = null;
        panState = null;
        // 框选完成——AABB碰撞检测
        if (boxSelect) {
            const pt = svgPoint(e);
            const x1 = Math.min(boxSelect.sx, pt.x);
            const y1 = Math.min(boxSelect.sy, pt.y);
            const x2 = Math.max(boxSelect.sx, pt.x);
            const y2 = Math.max(boxSelect.sy, pt.y);
            tempLayer.innerHTML = '';
            if (Math.abs(x2 - x1) > 5 && Math.abs(y2 - y1) > 5) {
                // 节点矩形与框选矩形是否相交
                const inBox = Object.entries(位置).filter(([nid, p]) => {
                    return p.x - 节点宽/2 < x2 && p.x + 节点宽/2 > x1 && p.y < y2 && p.y + 节点高 > y1;
                }).map(([nid]) => nid);
                if (boxSelect.alt) {
                    selectedNodes = selectedNodes.filter(id => !inBox.includes(id));
                } else if (boxSelect.ctrl) {
                    inBox.forEach(id => { if (!selectedNodes.includes(id)) selectedNodes.push(id); });
                } else {
                    selectedNodes = inBox;
                }
                updateSelection();
            }
            boxSelect = null;
        }
    });

    // 滚轮缩放
    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const vb = svg.viewBox.baseVal;
        const pt = svgPoint(e);
        const scale = e.deltaY > 0 ? 1.1 : 0.9;
        const newW = Math.max(100, Math.min(3000, vb.width * scale));
        const newH = Math.max(50, Math.min(3000, vb.height * scale));
        vb.x = pt.x - (pt.x - vb.x) * (newW / vb.width);
        vb.y = pt.y - (pt.y - vb.y) * (newH / vb.height);
        vb.width = newW; vb.height = newH;
    }, {passive: false});

    // 中键平移（独立handler，stopPropagation防止触发其他mousedown）
    svg.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            const vb = svg.viewBox.baseVal;
            panState = { sx: e.clientX, sy: e.clientY, vbX: vb.x, vbY: vb.y };
        }
    });

    // 键盘快捷键：Ctrl+C复制 / Ctrl+V粘贴 / Ctrl+Z撤销 / Ctrl+Y重做 / Delete删除
    svg.addEventListener('keydown', (e) => {
        const ctrl = e.ctrlKey || e.metaKey;
        // INPUT/TEXTAREA中不触发快捷键
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        // 撤销/重做
        if (ctrl && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (svg._onUndo) svg._onUndo();
            return;
        }
        if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            if (svg._onRedo) svg._onRedo();
            return;
        }
        if (ctrl && e.key === 'c') {
            e.preventDefault();
            // 复制选中节点 + 选中节点之间的连线
            if (selectedNodes.length === 0) return;
            clipboard = selectedNodes.map(nid => {
                const p = 位置[nid];
                const n = p ? p.节点 : null;
                return n ? { ...n, _x: p.x, _y: p.y } : null;
            }).filter(Boolean);
            showToastInSVG(`已复制 ${clipboard.length} 个节点`);
        } else if (ctrl && e.key === 'v') {
            e.preventDefault();
            if (clipboard.length === 0) return;
            // 粘贴：新ID + 偏移20px + 保持相对位置
            const idMap = {};
            const newIds = [];
            // 计算粘贴中心（剪贴板节点包围盒左上角）
            const minX = Math.min(...clipboard.map(c => c._x));
            const minY = Math.min(...clipboard.map(c => c._y));
            const offsetX = 30, offsetY = 30;
            // 粘贴基准点：使用画布中心或现有节点最小坐标
            const pasteBaseX = 100, pasteBaseY = 100;
            for (const item of clipboard) {
                const newId = 'n' + Date.now() + Math.random().toString(36).slice(2, 6);
                idMap[item.id || item.名称] = newId;
                const newNode = { ...item, id: newId };
                delete newNode._x; delete newNode._y;
                路线图.节点 = 路线图.节点 || [];
                路线图.节点.push(newNode);
                const nid = newNode.id || newNode.名称;
                位置[nid] = { x: item._x - minX + offsetX + pasteBaseX, y: item._y - minY + offsetY + pasteBaseY, 节点: newNode };
                newIds.push(nid);
            }
            // 复制剪贴板节点之间的连线
            const clipIds = new Set(clipboard.map(c => c.id || c.名称));
            const oldConns = 连接.filter(c => clipIds.has(c.from) && clipIds.has(c.to));
            for (const c of oldConns) {
                const nf = idMap[c.from], nt = idMap[c.to];
                if (nf && nt && !连接.find(x => x.from === nf && x.to === nt)) {
                    连接.push({ from: nf, to: nt });
                }
            }
            路线图.连接 = 连接;
            selectedNodes = newIds;
            updateSelection();
            renderNodes();
            renderConns();
            if (svg._onModify) svg._onModify();
            showToastInSVG(`已粘贴 ${clipboard.length} 个节点`);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (selectedNodes.length === 0) return;
            selectedNodes.forEach(nid => {
                const n = 位置[nid]?.节点;
                if (n) {
                    const xid = n.id || n.名称;
                    路线图.节点 = (路线图.节点||[]).filter(nn => (nn.id||nn.名称) !== xid);
                    路线图.连接 = (路线图.连接||[]).filter(c => c.from !== xid && c.to !== xid);
                    连接 = 路线图.连接;
                }
                delete 位置[nid];
            });
            selectedNodes = [];
            updateSelection();
            renderNodes();
            renderConns();
            if (svg._onModify) svg._onModify();
        }
    });

    // === 剪刀模式（按住Y） ===
    let scissorsMode = false;
    let cutPath = [];
    let cutLayer = null;

    function scissorsOn() {
        scissorsMode = true;
        svg.style.cursor = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\'><text y=\'18\' font-size=\'18\'>✂️</text></svg>") 8 16, crosshair';
        if (!cutLayer) {
            cutLayer = document.createElementNS(SVGNS, 'g');
            cutLayer.setAttribute('id', 'scissorsCutLayer');
            cutLayer.style.pointerEvents = 'none';
            svg.appendChild(cutLayer);
        }
        cutLayer.style.display = 'block';
        showToastInSVG('✂️ 剪刀模式：拖拽剪断连线');
    }
    function scissorsOff() {
        scissorsMode = false;
        svg.style.cursor = 'default';
        if (cutLayer) { cutLayer.style.display = 'none'; cutLayer.innerHTML = ''; }
        cutPath = [];
    }
    function segmentsIntersect(x1,y1,x2,y2, x3,y3,x4,y4) {
        const d1 = (x2-x1)*(y3-y1) - (x3-x1)*(y2-y1);
        const d2 = (x2-x1)*(y4-y1) - (x4-x1)*(y2-y1);
        const d3 = (x4-x3)*(y1-y3) - (x1-x3)*(y4-y3);
        const d4 = (x4-x3)*(y2-y3) - (x2-x3)*(y4-y3);
        return ((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0));
    }
    function executeCut() {
        if (cutPath.length < 2) { cutPath = []; return; }
        let removed = 0;
        连接 = 连接.filter(c => {
            const from = 位置[c.from], to = 位置[c.to];
            if (!from || !to) return true;
            const x1 = from.x, y1 = from.y + 节点高;
            const x2 = to.x, y2 = to.y;
            for (let i = 0; i < cutPath.length - 1; i++) {
                const a = cutPath[i], b = cutPath[i+1];
                if (segmentsIntersect(x1,y1,x2,y2, a.x,a.y, b.x,b.y)) { removed++; return false; }
            }
            return true;
        });
        路线图.连接 = 连接;
        if (removed > 0) {
            renderConns();
            if (svg._onModify) svg._onModify();
            showToastInSVG('✂️ 剪断了 ' + removed + ' 条连线');
        }
    }
    // 按住Y开启，松开Y关闭
    svg.addEventListener('keydown', (e) => {
        if (!e.ctrlKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
            if (!scissorsMode) scissorsOn();
        }
    });
    svg.addEventListener('keyup', (e) => {
        if ((e.key === 'y' || e.key === 'Y') && scissorsMode) scissorsOff();
    });
    // 剪刀模式下拖拽画轨迹
    svg.addEventListener('mousedown', (e) => {
        if (!scissorsMode || e.button !== 0) return;
        const pt = svgPoint(e);
        cutPath = [pt];
        e.preventDefault(); e.stopPropagation();
    });
    svg.addEventListener('mousemove', (e) => {
        if (!scissorsMode || cutPath.length === 0) return;
        const pt = svgPoint(e);
        cutPath.push(pt);
        if (cutLayer) {
            const d = 'M ' + cutPath.map(p => p.x + ' ' + p.y).join(' L ');
            const cutPath_el = document.createElementNS(SVGNS, 'path');
            cutPath_el.setAttribute('d', d);
            cutPath_el.setAttribute('stroke', 'rgba(241,76,76,0.8)');
            cutPath_el.setAttribute('stroke-width', '2');
            cutPath_el.setAttribute('fill', 'none');
            cutPath_el.setAttribute('stroke-dasharray', '4 3');
            cutPath_el.style.pointerEvents = 'none';
            cutLayer.innerHTML = '';
            cutLayer.appendChild(cutPath_el);
        }
    });
    document.addEventListener('mouseup', () => {
        if (!scissorsMode || cutPath.length < 2) { cutPath = []; return; }
        executeCut();
        cutPath = [];
        if (cutLayer) cutLayer.innerHTML = '';
    });
    svg.setAttribute('tabindex', '0'); // 让SVG可聚焦以接收键盘事件
    svg.style.outline = 'none';

    // 初始渲染
    renderConns();
    renderNodes();

    function showToastInSVG(msg) {
    // 在SVG顶部临时显示文字
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('x', 10); t.setAttribute('y', 14);
    t.setAttribute('font-size', '11'); t.setAttribute('fill', '#2ecc71');
    t.textContent = msg;
    t.style.opacity = '0'; t.style.transition = 'opacity 0.2s';
    svg.insertBefore(t, svg.firstChild);
    requestAnimationFrame(() => t.style.opacity = '1');
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 200); }, 1500);
}

    // 暴露API
    // 网格对齐（20px网格）
    function 对齐到网格(x, y) {
        const G = 20;
        return { x: Math.round(x / G) * G, y: Math.round(y / G) * G };
    }
    svg._addNode = (node) => {
        const nid = node.id || node.名称;
        const p = 对齐到网格(300, 20 + (层号++) * 层间距);
        位置[nid] = { x: p.x, y: p.y, 节点: node };
        renderNodes();
        renderConns();
    };
    svg._createFrame = (nodeIds) => {
        // 计算选中节点的包围盒
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        nodeIds.forEach(nid => {
            const p = 位置[nid];
            if (p) {
                minX = Math.min(minX, p.x - 节点宽/2);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x + 节点宽/2);
                maxY = Math.max(maxY, p.y + 节点高);
            }
        });
        const pad = 20, headerH = 24;
        const f = {
            id: 'frame_' + (++frameIdCounter),
            x: minX - pad, y: minY - pad - headerH,
            w: maxX - minX + pad*2, h: maxY - minY + pad*2 + headerH,
            text: '分组', color: FRAME_COLORS[frames.length % FRAME_COLORS.length],
            nodeIds: nodeIds.slice(),
        };
        frames.push(f);
        renderFrames();
        if (svg._onModify) svg._onModify();
        showToastInSVG('已创建分组: ' + f.text);
    };
    svg._zoomBy = (factor) => {
        const vb = svg.viewBox.baseVal;
        const cx = vb.x + vb.width/2, cy = vb.y + vb.height/2;
        vb.width = Math.max(100, Math.min(3000, vb.width * factor));
        vb.height = Math.max(50, Math.min(3000, vb.height * factor));
        vb.x = cx - vb.width/2; vb.y = cy - vb.height/2;
    };
    svg._fit = () => {
        const allX = Object.values(位置).map(p=>p.x), allY = Object.values(位置).map(p=>p.y);
        if (allX.length === 0) return;
        const minX = Math.min(...allX) - 节点宽/2 - 20, maxX = Math.max(...allX) + 节点宽/2 + 20;
        const minY = Math.min(...allY) - 20, maxY = Math.max(...allY) + 节点高 + 20;
        const vb = svg.viewBox.baseVal;
        vb.x = minX; vb.y = minY;
        vb.width = Math.max(maxX-minX, 200); vb.height = Math.max(maxY-minY, 100);
    };

    // 回调钩子——由addPlanToChat设置
    svg._onModify = null;    // 数据变更时调用(拖拽完成/连线/删连线)
    svg._onEditNode = null;  // 双击编辑节点时调用
    svg._onUndo = null;      // 撤销
    svg._onRedo = null;      // 重做

    // 就地刷新——撤销/重做时不重建SVG，只重算布局+重渲染
    svg._refresh = () => {
        // 重建内部数据
        const 新节点 = 路线图.节点 || [];
        连接 = 路线图.连接 || [];
        const 节点IDs2 = new Set(新节点.map(n => n.id || n.名称));
        const 补充节点2 = [];
        连接.forEach(c => {
            if (c.from && !节点IDs2.has(c.from)) { 补充节点2.push({id:c.from, 名称:c.from, 图标:'🎬', 类型:'起点'}); 节点IDs2.add(c.from); }
            if (c.to && !节点IDs2.has(c.to)) { 补充节点2.push({id:c.to, 名称:c.to, 图标:'⚪', 类型:'处理'}); 节点IDs2.add(c.to); }
        });
        const 全部节点2 = [...补充节点2, ...新节点];
        // 重新布局
        const 新位置 = {};
        const 所有目标2 = new Set(连接.map(c => c.to));
        let 当前层2 = 全部节点2.filter(n => !所有目标2.has(n.id || n.名称));
        if (当前层2.length === 0) 当前层2 = 全部节点2;
        let 已布局2 = new Set(), 层号2 = 0;
        while (当前层2.length > 0) {
            const 层宽度2 = (当前层2.length - 1) * 节点间距;
            当前层2.forEach((n, i) => {
                const nid = n.id || n.名称;
                新位置[nid] = { x: 300 - 层宽度2/2 + i * 节点间距, y: 20 + 层号2 * 层间距, 节点: n };
                已布局2.add(nid);
            });
            const 下一层2 = [];
            当前层2.forEach(n => {
                const nid = n.id || n.名称;
                连接.forEach(c => {
                    if (c.from === nid) {
                        const 目标 = 全部节点2.find(nn => (nn.id||nn.名称) === c.to);
                        if (目标 && !已布局2.has(c.to) && !下一层2.includes(目标)) 下一层2.push(目标);
                    }
                });
            });
            当前层2 = 下一层2; 层号2++;
        }
        全部节点2.forEach(n => {
            const nid = n.id || n.名称;
            if (!新位置[nid]) { 新位置[nid] = { x: 300, y: 20 + 层号2 * 层间距, 节点: n }; 层号2++; }
        });
        // 清空旧位置，写入新位置
        Object.keys(位置).forEach(k => delete 位置[k]);
        Object.assign(位置, 新位置);
        renderNodes();
        renderConns();
        renderFrames();
    };
    // frames访问器
    svg._getFrames = () => frames.map(f => ({...f, nodeIds: [...(f.nodeIds||[])]}));
    svg._setFrames = (newFrames) => {
        frames.length = 0;
        frames.push(...newFrames);
        renderFrames();
    };
    svg._onContextMenu = null; // 右键节点时调用

    // 拖拽角色到SVG上创建节点
    svg.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    svg.addEventListener('drop', (e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        try {
            const data = JSON.parse(raw);
            const pt = svgPoint(e);
            let newNode = null;
            if (data.kind === 'role') {
                newNode = {id: 'n' + Date.now() + Math.random().toString(36).slice(2,6), 名称: data.name, 图标: '🎭', 类型: '角色', config: {描述: data.desc || '', 提示词: data.prompt || '', 约束: ''}};
            } else if (data.kind === 'tool') {
                newNode = {id: 'n' + Date.now() + Math.random().toString(36).slice(2,6), 名称: data.label, 图标: '🔧', 类型: '工具', 工具名: data.name, 工具参数: {}, config: {描述: data.label, 提示词: '', 约束: ''}};
            }
            if (newNode) {
                路线图.节点 = 路线图.节点 || [];
                路线图.节点.push(newNode);
                const nid = newNode.id;
                const p = 对齐到网格(pt.x, pt.y);
                位置[nid] = { x: p.x, y: p.y, 节点: newNode };
                renderNodes();
                renderConns();
                if (svg._onModify) svg._onModify();
            }
        } catch(err) {}
    });

    return svg;
}

// === 节点右键菜单（含AI生成提示词） ===
function showNodeContextMenu(x, y, node, 路线图, render, onModified, currentSvgEl) {
    // 移除旧菜单
    const old = document.querySelector('.rm-context-menu');
    if (old) old.remove();

    const menu = document.createElement('div');
    menu.className = 'rm-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const items = [
        {label:'✏️ 编辑节点', action:()=>{
            if (currentSvgEl && currentSvgEl._onEditNode) currentSvgEl._onEditNode(node, render);
        }},
        {label:'🤖 AI生成提示词', action:()=>aiGeneratePrompt(node, onModified)},
        {sep:true},
        {label:'🗑️ 删除节点', danger:true, action:()=>{
            const nid = node.id || node.名称;
            路线图.节点 = (路线图.节点||[]).filter(n => (n.id||n.名称) !== nid);
            路线图.连接 = (路线图.连接||[]).filter(c => c.from !== nid && c.to !== nid);
            onModified();
        }},
        {label:'🚫 禁用节点', action:()=>{
            node.disabled = !node.disabled;
            onModified();
        }},
    ];

    menu.innerHTML = items.map((item, i) => {
        if (item.sep) return '<div class="rm-menu-sep"></div>';
        return `<div class="rm-menu-item ${item.danger?'rm-menu-danger':''}" data-idx="${i}">${item.label}</div>`;
    }).join('');

    menu.querySelectorAll('.rm-menu-item').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const item = items[parseInt(el.dataset.idx)];
            if (item && item.action) item.action();
            menu.remove();
        });
    });

    document.body.appendChild(menu);
    // 点击别处关闭
    setTimeout(() => {
        const closer = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closer); }};
        document.addEventListener('click', closer);
    }, 0);
}

function aiGeneratePrompt(node, onModified) {
    // 调LLM为节点生成提示词
    log('系统', '🤖 AI正在为「' + (node.名称||node.类型) + '」生成提示词...');

    fetch(API_BASE + '/api/roadmap/gen-prompt', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({类型: node.类型, 名称: node.名称||'', 工具名: node.工具名||'', 描述: node.描述||''})
    }).then(r => r.json()).then(d => {
        if (d.错误) { log('系统', '❌ ' + d.错误); return; }
        log('系统', '✅ AI提示词已生成');
        // 把AI生成的提示词注入消息框让用户能看到
        const msgEl = messagesEl || document.getElementById('messages');
        if (msgEl) {
            const div = document.createElement('div');
            div.className = 'msg assistant';
            div.innerHTML = `<strong>🤖 AI为「${node.名称||node.类型}」生成的提示词:</strong><br><code style="white-space:pre-wrap;font-size:12px;">${(d.提示词||'').replace(/</g,'&lt;')}</code>`;
            msgEl.appendChild(div);
            msgEl.scrollTop = msgEl.scrollHeight;
        }
    }).catch(e => log('系统', '❌ AI生成失败: ' + e.message));
}

// === 内联节点编辑面板 ===
function showNodeEditor(node, onSave) {
    const isNew = !node;
    const n = node || {id: 'n' + Date.now(), 名称: '', 图标: '⚪', 类型: '处理'};
    if (!n.config) n.config = {};
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width:480px">
            <div class="modal-title">${isNew?'➕ 新建节点':'✏️ 编辑节点'}</div>
            <div style="display:flex;gap:10px;margin-bottom:10px">
                <div style="flex:0 0 60px">
                    <div style="font-size:10px;color:#8888aa;margin-bottom:2px">图标</div>
                    <input id="ne-icon" value="${n.图标||'⚪'}" style="width:60px;text-align:center;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px;color:#c8c8e0;font-size:18px;outline:none;">
                </div>
                <div style="flex:1">
                    <div style="font-size:10px;color:#8888aa;margin-bottom:2px">标题（节点名称）</div>
                    <input id="ne-name" value="${n.名称||''}" placeholder="如：翻译官" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:14px;outline:none;">
                </div>
            </div>
            <div style="margin-bottom:10px">
                <div style="font-size:10px;color:#8888aa;margin-bottom:2px">一句话描述（这个节点干什么）</div>
                <input id="ne-desc" value="${n.config.描述||''}" placeholder="如：将上游文本翻译成中文" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:13px;outline:none;">
            </div>
            <div style="margin-bottom:10px">
                <div style="font-size:10px;color:#8888aa;margin-bottom:2px">提示词（决定节点行为，留空则自动判断）</div>
                <textarea id="ne-prompt" rows="4" placeholder="如：你是一个翻译专家，收到上游文本后翻译为中文，只输出译文。" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:12px;outline:none;resize:vertical;font-family:inherit;">${(n.config.提示词||'').replace(/</g,'&lt;')}</textarea>
                <div style="display:flex;gap:6px;margin-top:4px">
                    <button id="ne-aigen" class="modal-btn" style="font-size:11px;padding:4px 10px">🤖 AI生成</button>
                    <button id="ne-tool-toggle" class="modal-btn" style="font-size:11px;padding:4px 10px">${n.工具名?'🔧 工具节点 ✓':'🔧 设为工具节点'}</button>
                </div>
            </div>
            <div style="margin-bottom:10px">
                <div style="font-size:10px;color:#8888aa;margin-bottom:2px">一句话约束（额外限制，附加到提示词末尾）</div>
                <input id="ne-constraint" value="${n.config.约束||''}" placeholder="如：输出不超过100字" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:13px;outline:none;">
            </div>
            <div id="ne-tool-fields" style="${n.工具名?'':'display:none;'}margin-bottom:10px">
                <div style="font-size:10px;color:#8888aa;margin-bottom:2px">选择工具</div>
                <select id="ne-toolname" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:13px;outline:none;margin-bottom:6px;">
                    <option value="">— 选择工具 —</option>
                    <option value="read_file" ${(n.工具名==='read_file')?'selected':''}>📄 读取文件</option>
                    <option value="write_file" ${(n.工具名==='write_file')?'selected':''}>✏️ 写入文件</option>
                    <option value="create_file" ${(n.工具名==='create_file')?'selected':''}>📝 创建文件</option>
                    <option value="list_dir" ${(n.工具名==='list_dir')?'selected':''}>📁 列出目录</option>
                    <option value="search_code" ${(n.工具名==='search_code')?'selected':''}>🔍 搜索代码</option>
                    <option value="run_command" ${(n.工具名==='run_command')?'selected':''}>💻 运行命令</option>
                    <option value="get_time" ${(n.工具名==='get_time')?'selected':''}>🕐 获取时间</option>
                    <option value="file_info" ${(n.工具名==='file_info')?'selected':''}>📊 文件信息</option>
                    <option value="read_lines" ${(n.工具名==='read_lines')?'selected':''}>📐 读指定行</option>
                    <option value="read_head" ${(n.工具名==='read_head')?'selected':''}>📐 读头部</option>
                    <option value="read_tail" ${(n.工具名==='read_tail')?'selected':''}>📐 读尾部</option>
                    <option value="tree_dir" ${(n.工具名==='tree_dir')?'selected':''}>🌳 目录树</option>
                </select>
                <div id="ne-tool-params-form" style="margin-top:4px"></div>
            </div>
            <div class="modal-actions" style="margin-top:12px;">
                <button id="ne-cancel" class="modal-btn">取消</button>
                <button id="ne-ok" class="modal-btn modal-btn-primary">确认</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // 工具节点切换
    const toolFields = overlay.querySelector('#ne-tool-fields');
    const toolToggle = overlay.querySelector('#ne-tool-toggle');
    const toolNameSel = overlay.querySelector('#ne-toolname');
    const paramsForm = overlay.querySelector('#ne-tool-params-form');

    // 工具参数定义
    const TOOL_PARAMS = {
        read_file: [{key:'path', label:'文件路径', placeholder:'如: 启动.py'}, {key:'offset', label:'起始行(可选)', placeholder:'0'}, {key:'limit', label:'行数(可选)', placeholder:'0'}, {key:'keyword', label:'关键词(可选)', placeholder:''}],
        write_file: [{key:'path', label:'文件路径', placeholder:''}, {key:'content', label:'内容', placeholder:'', textarea:true}],
        create_file: [{key:'path', label:'文件路径', placeholder:''}, {key:'content', label:'内容', placeholder:'', textarea:true}],
        list_dir: [{key:'path', label:'目录路径', placeholder:'.', default:'.'}],
        search_code: [{key:'keyword', label:'搜索关键词', placeholder:''}, {key:'path', label:'搜索路径', placeholder:'.', default:'.'}],
        run_command: [{key:'command', label:'命令', placeholder:''}, {key:'workdir', label:'工作目录(可选)', placeholder:''}],
        get_time: [],
        file_info: [{key:'path', label:'文件路径', placeholder:''}],
        read_lines: [{key:'path', label:'文件路径', placeholder:''}, {key:'start', label:'起始行', placeholder:'1'}, {key:'end', label:'结束行', placeholder:'10'}],
        read_head: [{key:'path', label:'文件路径', placeholder:''}, {key:'lines', label:'行数', placeholder:'20'}],
        read_tail: [{key:'path', label:'文件路径', placeholder:''}, {key:'lines', label:'行数', placeholder:'20'}],
        tree_dir: [{key:'path', label:'目录路径', placeholder:'.'}, {key:'depth', label:'深度', placeholder:'3'}],
    };

    function renderToolParams() {
        const tool = toolNameSel.value;
        const params = TOOL_PARAMS[tool] || [];
        const existing = n.工具参数 || {};
        if (params.length === 0) {
            paramsForm.innerHTML = '<div style="font-size:10px;color:#555577;padding:4px">此工具无需参数</div>';
            return;
        }
        paramsForm.innerHTML = params.map(p => {
            const val = existing[p.key] ?? p.default ?? '';
            if (p.textarea) {
                return `<div style="margin-bottom:4px"><div style="font-size:10px;color:#8888aa;margin-bottom:2px">${p.label}</div><textarea class="ne-param" data-key="${p.key}" rows="2" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:12px;outline:none;resize:vertical;font-family:inherit;">${String(val).replace(/</g,'&lt;')}</textarea></div>`;
            }
            return `<div style="margin-bottom:4px"><div style="font-size:10px;color:#8888aa;margin-bottom:2px">${p.label}</div><input class="ne-param" data-key="${p.key}" value="${String(val).replace(/"/g,'&quot;')}" placeholder="${p.placeholder||''}" style="width:100%;background:#12121e;border:1px solid #2a2a44;border-radius:6px;padding:6px 10px;color:#c8c8e0;font-size:12px;outline:none;"></div>`;
        }).join('');
    }
    toolNameSel.addEventListener('change', renderToolParams);
    renderToolParams();

    toolToggle.onclick = () => {
        const visible = toolFields.style.display !== 'none';
        if (visible) {
            toolFields.style.display = 'none';
            toolToggle.textContent = '🔧 设为工具节点';
            overlay.querySelector('#ne-toolname').value = '';
        } else {
            toolFields.style.display = 'block';
            toolToggle.textContent = '🔧 工具节点 ✓';
        }
    };

    // AI生成提示词按钮
    overlay.querySelector('#ne-aigen').onclick = () => {
        const 名称 = overlay.querySelector('#ne-name').value.trim();
        const 描述 = overlay.querySelector('#ne-desc').value.trim();
        const isTool = toolFields.style.display !== 'none';
        const btn = overlay.querySelector('#ne-aigen');
        btn.textContent = '⏳ 生成中...'; btn.disabled = true;
        fetch(API_BASE + '/api/roadmap/gen-prompt', {method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({类型: isTool?'工具':'处理', 名称, 描述, 工具名: overlay.querySelector('#ne-toolname').value.trim()})})
        .then(r => r.json()).then(d => {
            btn.textContent = '🤖 AI生成'; btn.disabled = false;
            if (d.错误) { alert(d.错误); return; }
            overlay.querySelector('#ne-prompt').value = d.提示词 || '';
        }).catch(e => { btn.textContent = '🤖 AI生成'; btn.disabled = false; alert('生成失败: '+e.message); });
    };

    const close = () => overlay.remove();
    overlay.querySelector('#ne-cancel').onclick = close;
    overlay.querySelector('#ne-ok').onclick = () => {
        n.名称 = overlay.querySelector('#ne-name').value.trim();
        n.图标 = overlay.querySelector('#ne-icon').value || '⚪';
        n.config.描述 = overlay.querySelector('#ne-desc').value.trim();
        n.config.提示词 = overlay.querySelector('#ne-prompt').value;
        n.config.约束 = overlay.querySelector('#ne-constraint').value.trim();
        // 类型自动判断：有工具名→工具，否则→处理（通用LLM节点）
        const toolName = overlay.querySelector('#ne-toolname').value.trim();
        if (toolName) {
            n.类型 = '工具';
            n.工具名 = toolName;
            // 从表单收集参数
            n.工具参数 = {};
            overlay.querySelectorAll('.ne-param').forEach(inp => {
                const k = inp.dataset.key;
                const v = inp.value.trim();
                if (v) {
                    // 尝试转为数字
                    n.工具参数[k] = /^\d+$/.test(v) ? parseInt(v) : v;
                }
            });
        } else {
            n.类型 = '处理';
            delete n.工具名;
            delete n.工具参数;
        }
        close();
        if (onSave) onSave(n);
    };
    overlay.querySelector('#ne-name').focus();
}
