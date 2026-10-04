const fs=require('fs');
const codes=['app-kite-core.js','app-kite-panels.js','app-kite-vision.js','app-kite-nodes.js','app-kite-links.js'];
const stubDoc={getElementById:()=>null,addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,body:{appendChild(){},addEventListener(){}},createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},appendChild(){},setAttribute(){}})};
for(const f of codes){
  try{ new Function('window','document', fs.readFileSync(f,'utf8'))({addEventListener(){},App:{},__KiteNS:undefined},stubDoc); console.log('OK  ',f); }
  catch(e){ console.log('FAIL',f,'=>',e.message); }
}
