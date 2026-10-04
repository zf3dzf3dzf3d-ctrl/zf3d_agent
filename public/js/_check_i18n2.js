const fs = require('fs');
const dir = 'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.2.5/public/js';
global.window = {};
for (const f of ['i18n-data.js','i18n-data-multi.js','i18n-data-settings.js','i18n-data-extra.js']) {
  try { eval(fs.readFileSync(dir + '/' + f, 'utf8')); } catch (e) { console.log(f,'ERR',e.message); }
}
const D = window.__I18N_DATA || {};
const M = window.__I18N_MULTI || {};
const P = window.I18N_SETTINGS_PATCH || {};
const CN2EN = Object.assign({}, D.CN2EN||{});
for (const k in (D.en||{})) if (CN2EN[k]===undefined) CN2EN[k]=D.en[k];
for (const k in (D.EXTRA||{})) if (CN2EN[k]===undefined) CN2EN[k]=D.EXTRA[k];
// apply settings patch to multi (like the W block does)
for (const lg of ['ja','ko','de','ar','hi','es','fr','ru','en']) {
  if (!P[lg]) continue;
  if (lg==='en') { /* into CN2EN */ for (const k in P.en) if (CN2EN[k]===undefined) CN2EN[k]=P.en[k]; }
  else { if (!M[lg]) M[lg]={}; for (const k in P[lg]) if (M[lg][k]===undefined) M[lg][k]=P[lg][k]; }
}
const langs = ['en','ja','ko','de','ar','hi','es','fr','ru'];
// universe: any zh string appearing in CN2EN or any MULTI dict
const uni = new Set(Object.keys(CN2EN));
for (const lg of langs) { if (lg==='en') continue; for (const k in (M[lg]||{})) uni.add(k); }
const out = {};
for (const lg of langs) {
  const miss = [...uni].filter(k => lg==='en' ? CN2EN[k]===undefined : (M[lg]||{})[k]===undefined);
  out[lg] = miss;
  console.log(lg, 'missing:', miss.length);
}
fs.writeFileSync(dir+'/_missing.json', JSON.stringify(out,null,1),'utf8');
console.log('total uni:', uni.size);
