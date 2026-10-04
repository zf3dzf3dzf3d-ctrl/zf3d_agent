const fs=require('fs');
function parseObj(src){try{return (new Function('return '+src))();}catch(e){console.error('parse fail:',e.message);return null;}}
const dir=__dirname+'/';
const s1=fs.readFileSync(dir+'i18n-data.js','utf8');
const i1=s1.indexOf('const CN2EN={');
const CN2EN=parseObj(s1.slice(i1+'const CN2EN={'.length-1, s1.indexOf('\n};', i1)+2));
const cnKeys=Object.keys(CN2EN);
const s2=fs.readFileSync(dir+'i18n-data-extra.js','utf8');
const iP=s2.indexOf('var P={');
const P=parseObj(s2.slice(iP+'var P='.length, s2.lastIndexOf('})();')).trim().replace(/;$/,''));
const out={};
for(const l of Object.keys(P)){
  const fb=Object.keys(P[l]).filter(k=>P[l][k]===CN2EN[k]&&/[\u4e00-\u9fff]/.test(k));
  out[l]=fb;
  const short=fb.filter(k=>k.length<=20);
  console.log('##',l,'total untranslated:',fb.length,'short:',short.length);
  console.log(short.slice(0,40).join(' | '));
}
fs.writeFileSync(dir+'_untranslated.json',JSON.stringify(out,null,1));
