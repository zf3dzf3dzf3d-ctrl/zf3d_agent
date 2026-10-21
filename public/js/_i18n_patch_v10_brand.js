
/* ---- v10 patch: 品牌新键「朱峰智能体无限」沿用旧键「朱峰社区无限」的各语言值（顶栏中文默认文本改名配套） ---- */
(function(){
try{
var M=window.__I18N_MULTI||(window.__I18N_MULTI={});
['ja','ko','de','ar','hi','es','fr','ru','en'].forEach(function(lg){
  if(!M[lg])return;
  if(M[lg]['\u6731\u5cf0\u793e\u533a\u65e0\u9650']!==undefined&&M[lg]['\u6731\u5cf0\u667a\u80fd\u4f53\u65e0\u9650']===undefined){
    M[lg]['\u6731\u5cf0\u667a\u80fd\u4f53\u65e0\u9650']=M[lg]['\u6731\u5cf0\u793e\u533a\u65e0\u9650'];
  }
});
}catch(e){console.warn('i18n brand key patch err',e);}
})();
