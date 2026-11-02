// 涌现树拖拽级联回归测试（headless 逻辑仿真，非浏览器实测）
// 目的：坐实修复 commit e38980e54 —— 拖动子节点时「父/祖先绝不进 drag.snap」。
// 方法：从 viewer.html 逐行照搬 descendantIds/subtreeIds/buildIndex/findRaw/ancestors
//       以及 mousedown 构建 snap 的那一行逻辑，构造 mock 树跑断言。
// 运行：node tests/drag_cascade.test.js

// ===== 照搬 viewer.html line 296-299 的索引与遍历函数 =====
let tree = null;
let rawIndex = {};
function buildIndex(){ rawIndex={}; (function w(arr){ arr.forEach(n=>{rawIndex[n.id]=n; if(n.children) w(n.children);}); })(tree.roots||[]); }
function findRaw(id){ return rawIndex[id]; }
function ancestors(id){ const out=[]; let n=findRaw(id); while(n){ n.parent_id!=null && out.push(n.parent_id); n=findRaw(n.parent_id); } return out; }

// 聚焦路径专用（含祖先链）—— 照搬 viewer.html line 280-288
function subtreeIds(rootId){
  const set=new Set();
  function collect(id){ set.add(id); const n=findRaw(id); if(n&&n.children) n.children.forEach(c=>collect(c.id)); }
  collect(rootId);
  const anc=ancestors(rootId); anc.forEach(a=>set.add(a));
  return set;
}
// 拖拽级联专用（仅后代含自身，不含祖先）—— 照搬 viewer.html line 290-295
function descendantIds(rootId){
  buildIndex();
  const set=new Set();
  (function collect(id){ set.add(id); const n=findRaw(id); if(n&&n.children) n.children.forEach(c=>collect(c.id)); })(rootId);
  return set;
}

// ===== 照搬 viewer.html mousedown line 204-205 的 snap 构建 =====
function buildSnapForHit(nodes, hitId){
  const ids = descendantIds(hitId);
  const snap = {}; nodes.forEach(n=>{ if(ids.has(n.id)) snap[n.id]={x:n.wx,y:n.wy}; });
  return snap;
}

// ===== 构造 mock 树 =====
//        R
//        |
//        A
//       / \
//      B   C
//      |
//      D
function makeMock(){
  const R={id:'R',parent_id:null,children:[]};
  const A={id:'A',parent_id:'R',children:[]};
  const B={id:'B',parent_id:'A',children:[]};
  const C={id:'C',parent_id:'A',children:[]};
  const D={id:'D',parent_id:'B',children:[]};
  R.children.push(A); A.children.push(B,C); B.children.push(D);
  tree={roots:[R]};
  const nodes=[
    {id:'R',wx:0,wy:0},{id:'A',wx:0,wy:50},{id:'B',wx:-30,wy:100},
    {id:'C',wx:30,wy:100},{id:'D',wx:-30,wy:150},
  ];
  buildIndex();
  return nodes;
}

let pass=0, fail=0;
function assert(name, cond){ if(cond){ pass++; console.log('  [PASS] '+name); } else { fail++; console.log('  [FAIL] '+name); } }

console.log('== 场景1：拖动叶子 B（父=A，祖父=R，兄弟=C，后代=D）==');
let nodes=makeMock();
let snap=buildSnapForHit(nodes,'B');
let keys=Object.keys(snap).sort();
assert('B 的 snap 键集合 == [B,D]', JSON.stringify(keys)==='["B","D"]');
assert('父 A 不在 snap（核心 bug 消除）', !('A' in snap));
assert('祖父 R 不在 snap', !('R' in snap));
assert('兄弟 C 不在 snap', !('C' in snap));

console.log('== 场景2：拖动中间节点 A（父=R，后代=B,C,D）==');
nodes=makeMock();
snap=buildSnapForHit(nodes,'A');
keys=Object.keys(snap).sort();
assert('A 的 snap 键集合 == [A,B,C,D]', JSON.stringify(keys)==='["A","B","C","D"]');
assert('父 R 不在 snap', !('R' in snap));

console.log('== 场景3：拖动叶子 C（无后代）==');
nodes=makeMock();
snap=buildSnapForHit(nodes,'C');
keys=Object.keys(snap).sort();
assert('C 的 snap 键集合 == [C]', JSON.stringify(keys)==='["C"]');

console.log('== 场景4：聚焦路径 subtreeIds 仍含祖先（语义未误伤）==');
nodes=makeMock();
let fs=[...subtreeIds('B')].sort();
assert('subtreeIds(B) == [A,B,D,R] 含祖先', JSON.stringify(fs)==='["A","B","D","R"]');

console.log('');
console.log('结果：'+pass+' 通过 / '+fail+' 失败');
process.exit(fail===0?0:1);
