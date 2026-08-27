(function(){
'use strict';

var KEY='zf3d.contextLoopConfig.v1';
var STEP_DEFAULTS=[
  {id:'read',enabled:true,label:'读取用户消息',toolPolicy:'按模型决定',maxExecutions:1,description:'接收并整理用户本轮输入，作为智能体循环的起点。通常每轮只需要读取一次；增加次数不会产生新的用户消息，建议保持为 1。'},
  {id:'think',enabled:true,label:'请求大模型',toolPolicy:'允许工具调用',maxExecutions:40,description:'把当前上下文发送给大模型，让模型决定回复内容或下一步工具调用。数量越大，允许模型在同一轮继续推理的机会越多，但也会增加 token 消耗和等待时间。'},
  {id:'tools',enabled:true,label:'执行工具并回传结果',toolPolicy:'串行执行',maxExecutions:40,description:'执行模型提出的工具调用，并把工具结果放回上下文供模型继续判断。数量越大，单轮可处理的工具链越长；设置过小可能导致任务尚未完成就提前停止。'},
  {id:'observe',enabled:true,label:'观察本轮结果',toolPolicy:'等待并刷新状态',maxExecutions:40,description:'等待工具或模型结果返回，并刷新循环状态，帮助系统判断是否继续。数量越大，越能容纳异步或多阶段结果，但会延长循环可能持续的时间。'},
  {id:'compress',enabled:false,label:'压缩上下文',toolPolicy:'达到阈值时执行',maxExecutions:1,description:'当上下文达到压缩阈值时整理较早消息，尽量保留任务重点并降低请求体积。每轮通常压缩一次即可；关闭或设为 0 可能让上下文持续变长并增加模型请求失败风险。'}
];
var defaults={enabled:true,maxRounds:200,compressAfterMessages:99999,keepRecentMessages:20,observationDelayMs:300,loopBreakLimit:50,retryMaxPerRound:3,retryIntervalMs:3000,retryRounds429:2,retryBackoff429Ms:[5000,15000,40000,90000,180000],retryRounds:1,retryRoundIntervalMs:300000,contextTokenBudget:0,toolResultMaxChars:10000,toolResultKeepRecent:30,toolResultMaxKeep:50,avoidRedundantReply:true,steps:STEP_DEFAULTS};

function clone(value){return JSON.parse(JSON.stringify(value));}
function mergeConfig(saved){
  var result=clone(defaults), source=saved||{};
  Object.keys(source).forEach(function(key){if(key!=='steps')result[key]=source[key];});
  var savedSteps=Array.isArray(source.steps)?source.steps:[];
  result.steps=result.steps.map(function(step){
    var savedStep=savedSteps.find(function(item){return item.id===step.id;});
    return Object.assign({},step,savedStep||{});
  });
  return result;
}
function migrateSaved(raw){
  if(!raw||typeof raw!=='object')return raw;
  var changed=false;
  if(raw.maxRounds===12||raw.maxRounds===159){raw.maxRounds=200;changed=true;}
  // 迁移过高的重试配置到合理值，避免502/429时疯狂重试卡死
  if(raw.retryMaxPerRound!=null&&raw.retryMaxPerRound>5){raw.retryMaxPerRound=3;changed=true;}
  if(raw.retryRounds!=null&&raw.retryRounds>2){raw.retryRounds=1;changed=true;}
  if(raw.retryRounds429!=null&&raw.retryRounds429>3){raw.retryRounds429=2;changed=true;}
  if(Array.isArray(raw.steps)){
    var upgrades={think:40,observe:40,tools:40};
    raw.steps.forEach(function(step){
      if(!step||!step.id||!upgrades[step.id])return;
      var old=step.maxExecutions;
      if(old===12){step.maxExecutions=upgrades[step.id];changed=true;}
    });
  }
  if(changed){try{localStorage.setItem(KEY,JSON.stringify(raw));}catch(e){}}
  return raw;
}
function load(){
  try{return mergeConfig(migrateSaved(JSON.parse(localStorage.getItem(KEY))||{}));}
  catch(error){return clone(defaults);}
}
var config=load();
window.ContextLoopConfig={
  get:function(){return config;},
  load:load,
  save:function(value){config=mergeConfig(value);localStorage.setItem(KEY,JSON.stringify(config));return config;},
  defaults:clone(defaults)
};
function escapeHtml(value){return String(value).replace(/[&<>\"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char];});}
function numberField(label,key,value,min,max,stepId,hint){
  if(value==null||value===''||isNaN(Number(value))){value=0;}
  var data=stepId?' data-step-config="'+stepId+'" data-config="'+key+'"':' data-config="'+key+'"';
  var hintHtml=hint?'<small class="context-loop-hint">'+escapeHtml(hint)+'</small>':'';
  return '<label class="context-loop-field"><span>'+escapeHtml(label)+'</span><input type="number"'+data+' value="'+escapeHtml(String(value))+'" min="'+escapeHtml(String(min))+'" max="'+escapeHtml(String(max))+'" step="1">'+hintHtml+'</label>';
}
function markDirty(){var status=document.getElementById('contextLoopStatus');if(status){status.textContent='有未保存修改';status.style.color='#c77700';}}
function checkboxField(label,key,value,hint){
  var hintHtml=hint?'<small class="context-loop-hint">'+escapeHtml(hint)+'</small>':'';
  return '<label class="context-loop-field"><span>'+escapeHtml(label)+'</span><input type="checkbox" data-config="'+key+'" '+(value?'checked':'')+'>'+hintHtml+'</label>';
}
function textField(label,key,value,hint){
  var hintHtml=hint?'<small class="context-loop-hint">'+escapeHtml(hint)+'</small>':'';
  return '<label class="context-loop-field"><span>'+label+'</span><input type="text" data-config="'+key+'" value="'+escapeHtml(String(value))+'" style="width:100%">'+hintHtml+'</label>';
}
function render(){
  var flow=document.getElementById('contextLoopFlow');
  if(!flow)return;
  var html='<div class="context-loop-step '+(config.enabled?'':'is-disabled')+'"><div class="context-loop-step-head"><span class="context-loop-step-index">总</span><span class="context-loop-step-title">循环控制</span><label><input type="checkbox" data-config="enabled" '+(config.enabled?'checked':'')+'> 启用</label></div><p class="context-loop-description">控制整个智能体上下文循环是否运行。关闭后不会按下面的步骤自动推进；下面的数量参数只会影响已启用的循环。</p><div class="context-loop-fields">'
    +numberField('单次最多循环轮数','maxRounds',config.maxRounds,1,1000,'','调小更省资源但复杂任务可能中断；调大能一口气跑完长任务，卡住也有单步超时兜底。上限已放开至 1000，长任务可填 500+。')
    +numberField('观察状态延迟（毫秒）','observationDelayMs',config.observationDelayMs,0,10000,'','每跑一步后停下来等结果刷新的间隔。卡顿时调大（如 800）更稳；平时 300 不用动。')
    +numberField('检测到死循环连续触发多少次后真正停止','loopBreakLimit',config.loopBreakLimit,1,50,'','检测到同一文件/目录被反复读取等死循环迹象时，系统会先自动发送纠正消息让 AI 自查。该值决定纠正多少次后仍无改善才真正强制停止。默认 50（50 次内足够 AI 自查修正）；想多给机会就调大，想更早止损就调小。')
    +numberField('每轮最多自动重试次数','retryMaxPerRound',config.retryMaxPerRound,0,50,'','网络/限流/服务端错误时，单轮内最多自动重试几次。0=不重试直接失败。')
    +numberField('重试间隔（毫秒）','retryIntervalMs',config.retryIntervalMs,100,60000,'','普通错误（非 429）每次重试之间等待的毫秒数。')
    +numberField('普通错误重试轮数','retryRounds',config.retryRounds,1,20,'','每轮重试都用完后，等待轮间间隔后再开下一轮。')
    +numberField('429 限流重试轮数','retryRounds429',config.retryRounds429,1,20,'','429 限流专用，可等多轮恢复，避免直接判死。')
    +numberField('轮间等待间隔（毫秒）','retryRoundIntervalMs',config.retryRoundIntervalMs,1000,3600000,'','每一轮重试之间等待的毫秒数，默认 300000（5分钟）。')
    +textField('重试触发状态码（逗号分隔）','retryStatusCodes',config.retryStatusCodes,'网络错误0、400格式错误、429限流、5xx服务端错误等，逗号分隔。')
    +textField('429 限流退避间隔（毫秒，逗号分隔）','retryBackoff429Ms',config.retryBackoff429Ms,'429 限流专用指数退避，逗号分隔的毫秒数组，如 5000,15000,40000,90000,180000。')
    +numberField('HTTP 400 自动重建上下文次数','rebuild400Max',config.rebuild400Max,0,20,'','HTTP 400 时自动重建对话上下文并重发的最大次数，默认 10。')
    +numberField('达到步数上限后自动重规划次数','maxDepthRetries',config.maxDepthRetries,0,20,'','任务达到最大执行步数后，自动重规划并继续的最大次数，默认 5。')
    +numberField('单次上下文 Token 预算（0=自动）','contextTokenBudget',config.contextTokenBudget,0,200000,'','高级参数，保持 0 让系统自动判断即可；填太小会截断问题，填太大费钱费时。')
    +numberField('单条工具结果保留字符数','toolResultMaxChars',config.toolResultMaxChars,100,50000,'','工具返回内容最多保留多少字符给模型看。做编程/读大文件调到 5000~8000 更准；纯聊天 3000 够用。')
    +numberField('工具结果保留最近条数','toolResultKeepRecent',config.toolResultKeepRecent,1,50,'','保留最近 N 条工具结果原文，更早的替换为 [已丢弃]（原文仍可通过 get_tool_result 工具找回）。调大更完整、调大更省 token。日常 3~5 够用。')
    +numberField('工具结果总条数上限','toolResultMaxKeep',config.toolResultMaxKeep,5,500,'','安全阀：上下文中工具结果总数超过该值时强制丢弃最旧的。只在极端长任务中触发，平时保持 50 即可。')
    +'</div></div>';
  config.steps.forEach(function(step,index){
    html+='<div class="context-loop-step '+(step.enabled?'':'is-disabled')+'"><div class="context-loop-step-head"><span class="context-loop-step-index">'+(index+1)+'</span><span class="context-loop-step-title">'+escapeHtml(step.label)+'</span><label><input type="checkbox" data-step="'+escapeHtml(step.id)+'" '+(step.enabled?'checked':'')+'> 启用</label></div><p class="context-loop-description">'+escapeHtml(step.description)+'</p><div class="context-loop-meta">当前策略：'+escapeHtml(step.toolPolicy)+'</div><div class="context-loop-fields">'
      +numberField('本轮最多执行次数','maxExecutions',step.maxExecutions,0,100,step.id,stepHint(step.id))+'</div></div>';
  });
  html+='<div class="context-loop-step"><div class="context-loop-step-head"><span class="context-loop-step-index">压</span><span class="context-loop-step-title">上下文压缩策略</span></div><p class="context-loop-description">控制上下文何时压缩，以及压缩后保留多少条最近消息。阈值越小越省请求体积，但可能更早丢失历史细节；保留条数越大，回答更完整，但会增加 token 消耗。</p><div class="context-loop-fields">'
    +numberField('累计消息达到多少句时压缩','compressAfterMessages',config.compressAfterMessages,2,1000,'','调小更省 token、响应更快；调大记住更多细节。常忘开头就往大调，又慢又贵就往小调。')
    +numberField('压缩后最多保留最近多少句','keepRecentMessages',config.keepRecentMessages,1,200,'','调大保留更多原文、回答更完整；调小更省。想更懂上下文就调大。')
    +'</div></div>';
  html+='<div class="context-loop-step"><div class="context-loop-step-head"><span class="context-loop-step-index">简</span><span class="context-loop-step-title">AI 回复精简（上下文瘦身）</span></div><p class="context-loop-description">开启后，系统提示词会要求 AI 回复精简直接：不复述问题、不铺垫、任务总结只写关键信息。能有效降低 AI 回复在上下文中的占比（此前实测约 25%），长对话更省 token。若需要 AI 详尽解释（如教学、文档场景），可关闭。</p><div class="context-loop-fields">'
    +checkboxField('要求 AI 回复精简（避免冗余）','avoidRedundantReply',config.avoidRedundantReply,'开启=在系统提示词加入精简规范（不重复问题、总结只写关键信息）；关闭=AI 回复更详细自由。')
    +'</div></div>';
  flow.innerHTML=html;
  flow.querySelectorAll('[data-config]').forEach(function(input){input.addEventListener('change',function(){
    if(input.dataset.stepConfig){var step=config.steps.find(function(item){return item.id===input.dataset.stepConfig;});if(step)step[input.dataset.config]=Math.max(0,Number(input.value)||0);}
    else config[input.dataset.config]=input.type==='checkbox'?input.checked:(input.type==='text'?input.value:Number(input.value));
    markDirty();
  });});
  flow.querySelectorAll('[data-step]').forEach(function(input){input.addEventListener('change',function(){var step=config.steps.find(function(item){return item.id===input.dataset.step;});if(step)step.enabled=input.checked;input.closest('.context-loop-step').classList.toggle('is-disabled',!input.checked);markDirty();});});
}
function stepHint(id){
  var hints={
    read:'每个步骤的最大执行次数。①读取用户消息：每轮读 1 次就够，再读还是同一条消息，白跑费 token，保持 1。',
    think:'①请求大模型：每调一次=模型思考+回答+决定下一步。复杂任务被掐断就继续调大（如 60）；纯聊天 40 都用不满。回答质量的关键旋钮。',
    tools:'①执行工具：每调一次工具算 1 次。做编程/自动化长任务调到 159；纯聊天很少用到 40。设太小任务没做完就停。',
    observe:'①观察结果：跟着 think/tools 联动，是保险丝。调大更稳，代价是多等；保持 40 一般不用动。',
    compress:'①压缩上下文：每轮压 1 次就整理完了，再压没有新东西，保持 1。'
  };
  return hints[id]||'本轮最多执行多少次。所有数值都只是上限，不会强制跑满，改坏最坏只是提前停，可随时调回。';
}
function init(){
  render();
  var save=document.getElementById('contextLoopSave'),reset=document.getElementById('contextLoopReset');
  if(save)save.onclick=function(){
    var status=document.getElementById('contextLoopStatus');
    try{
      ContextLoopConfig.save(config);
      if(status){status.textContent='已保存';status.style.color='var(--blue)';}
      if(window.App&&typeof window.App._toast==='function')window.App._toast('上下文与智能体循环配置已保存','ok');
    }catch(error){
      if(status){status.textContent='保存失败';status.style.color='var(--red, #f44336)';}
      if(window.App&&typeof window.App._toast==='function')window.App._toast('配置保存失败','err');
      // console.error('[context-loop] save failed',error);
    }
  };
  if(reset)reset.onclick=function(){config=clone(defaults);render();markDirty();};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
