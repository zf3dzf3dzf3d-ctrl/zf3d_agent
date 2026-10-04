const fs=require('fs');
const dir='F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.2.5/public/js/';
function parseObj(src){
  try{ return (new Function('return '+src))(); }catch(e){ console.error('parse fail',e.message); return null; }
}
// i18n-data.js CN2EN
const s1=fs.readFileSync(dir+'i18n-data.js','utf8');
const i1=s1.indexOf('const CN2EN={');
const src1=s1.slice(i1+'const CN2EN={'.length-1, s1.indexOf('\n};', i1)+2).replace('const CN2EN=','');
const CN2EN=parseObj(src1);
const cnKeys=Object.keys(CN2EN);
console.log('CN2EN keys:',cnKeys.length);

// extra.js
const s2=fs.readFileSync(dir+'i18n-data-extra.js','utf8');
const iP=s2.indexOf('var P={');
const srcP=s2.slice(iP+'var P='.length, s2.lastIndexOf('})();')).trim().replace(/;$/,'');
const P=parseObj(srcP);
for(const l of Object.keys(P)){
  const keys=Object.keys(P[l]);
  const missing=cnKeys.filter(k=>!(k in P[l]));
  const empty=keys.filter(k=>!P[l][k]||/^[A-Za-z\s]*$/.test(P[l][k])&&k.match(/[\u4e00-\u9fff]/)&&P[l][k]===CN2EN[k]);
  console.log('extra',l,'keys:',keys.length,'missing:',missing.length, 'fallbackEN(sample):',empty.length);
  if(missing.length)console.log('  missing sample:',missing.slice(0,10));
}

// multi.js
const s3=fs.readFileSync(dir+'i18n-data-multi.js','utf8');
for(const l of ['ja','ko','de']){
  const tag='const '+l+' = {';
  const i=s3.indexOf(tag);
  if(i<0){console.log('multi',l,'NOT FOUND');continue;}
  const src=s3.slice(i+tag.length-1, s3.indexOf('\n};', i)+2);
  const o=parseObj(src);
  const keys=Object.keys(o);
  const missing=cnKeys.filter(k=>!(k in o));
  console.log('multi',l,'keys:',keys.length,'missing vs CN2EN:',missing.length);
  if(missing.length)console.log('  sample:',missing.slice(0,10));
}

// zht
const s4=fs.readFileSync(dir+'i18n-data-zht.js','utf8');
const iz=s4.indexOf('= {');
const srcz=s4.slice(iz+2, s4.lastIndexOf('};')+1);
const Z=parseObj(srcz);
console.log('zht keys:',Object.keys(Z).length,'missing:',cnKeys.filter(k=>!(k in Z)).length);

// settings
const s5=fs.readFileSync(dir+'i18n-data-settings.js','utf8');
console.log('settings file lang entries:',(s5.match(/\b(ja|ko|de|ar|hi|es|fr|ru)":/g)||[]).length);
