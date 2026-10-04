/* ---- i18n patch v8: brand/logo + model-type tabs + more-menu + chatbox, multilingual correct ---- */
(function(){
try{
var EN={
"朱峰社区无限":"ZF3D AGENT",
"朱峰社区无限":"ZF Community Agent",
"朱峰社区智能体":"ZF Community Agent",
"朱峰智能体无限":"ZF Community Agent",
"语言":"Language","向量化":"Embedding","图片":"Image","视频":"Video","识图":"Vision","语音":"Speech","3D":"3D",
"思考":"Reasoning","工具":"Tools",
"朱峰社区网站":"ZF Community Site","访问朱峰智能体网站":"Visit zf3d.com",
"更多":"More","更多菜单":"More menu","提示":"Notice","确定":"OK","取消":"Cancel",
"整合下拉按钮":"Combined dropdown button",
"把游戏引擎、内置浏览器、演示 PPT 三个顶栏入口收进一个下拉菜单，节省顶栏宽度。":"Combines the three topbar entries — Game Engine, Built-in Browser, Demo PPT — into one dropdown to save topbar width.",
"演示 PPT":"Demo PPT","已开启":"on","已关闭":"off","中文/EN":"中文/EN",
"朗读助手：开/关":"Read Aloud: on/off",
"语言模块尚未加载完成，请刷新页面后重试（Ctrl+F5 强制刷新）":"Language module not loaded yet. Refresh the page (Ctrl+F5).",
"游戏引擎":"Game Engine","内置浏览器":"Built-in Browser",
"在画布上打开游戏引擎节点":"Open a game engine node on canvas",
"在画布上打开内置浏览器节点":"Open a built-in browser node on canvas",
"在画布上打开 AI 视频剪辑工作台":"Open the AI video editing workbench on canvas",
"新建对话":"New chat","设置 / 模型配置":"Settings / Model Config","切换语言":"Switch language",
"空回复":"Empty reply","模型未返回内容":"Model returned no content","请重试或换一条线路":"Please retry or switch to another line",
"用户尚未回答":"User has not answered yet","已调用工具":"Tool called","执行出错":"Execution error",
"管家正在处理":"Assistant is working…","无返回":"No response","新会话":"New session",
"编辑会话":"Edit session","临时":"Temporary","管家聊天窗输入框":"Assistant chat input",
"停止":"Stop","发送":"Send","正在输入…":"Typing…",
"模型未配置，请先在设置中配置大模型":"No model configured. Set one up in Settings first.",
"复制成功":"Copied","已复制":"Copied","重新生成":"Regenerate","编辑":"Edit","删除":"Delete",
"复制":"Copy","引用":"Quote","重发":"Resend","撤回":"Unsend",
"思考中…":"Thinking…","生成中…":"Generating…","回答完成":"Done","中断":"Stop"
};
var JA={
"朱峰社区无限":"ZF3D AGENT",
"朱峰智能体无限":"ZF3D AGENT",
"语言":"言語","向量化":"埋め込み","图片":"画像","视频":"動画","识图":"画像認識","语音":"音声",
"朱峰社区网站":"ZFコミュニティサイト","访问朱峰智能体网站":"zf3d.comへ",
"更多":"その他","更多菜单":"その他メニュー","提示":"通知","确定":"OK","取消":"キャンセル",
"整合下拉按钮":"統合ドロップダウン",
"演示 PPT":"デモPPT","已开启":"オン","已关闭":"オフ","中文/EN":"中文/EN",
"朗读助手：开/关":"読み上げ: オン/オフ",
"游戏引擎":"ゲームエンジン","内置浏览器":"内蔵ブラウザ",
"新建对话":"新規チャット","设置 / 模型配置":"設定 / モデル設定","切换语言":"言語切替",
"新会话":"新規セッション","编辑会話":"セッション編集","临时":"一時",
"停止":"停止","发送":"送信","复制":"コピー","删除":"削除","编辑":"編集",
"思考中…":"思考中…","生成中…":"生成中…"
};
var KO={
"朱峰社区无限":"ZF3D AGENT",
"语言":"언어","向量化":"임베딩","图片":"이미지","视频":"비디오","识图":"비전","语音":"음성",
"朱峰社区网站":"ZF 커뮤니티 사이트","访问朱峰智能体网站":"zf3d.com 방문",
"更多":"더보기","更多菜单":"더보기 메뉴","提示":"알림","确定":"확인","取消":"취소",
"整合下拉按钮":"통합 드롭다운",
"演示 PPT":"데모 PPT","已开启":"켜짐","已关闭":"꺼짐","中文/EN":"中文/EN",
"朗读助手：开/关":"읽어주기: 켜기/끄기",
"游戏引擎":"게임 엔진","内置浏览器":"내장 브라우저",
"新建对话":"새 대화","设置 / 模型配置":"설정 / 모델 설정","切换语言":"언어 전환",
"新会话":"새 세션","临时":"임시",
"停止":"정지","发送":"전송","复制":"복사","删除":"삭제","编辑":"편집",
"思考中…":"생각 중…","生成中…":"생성 중…"
};
var DE={
"朱峰社区无限":"ZF3D AGENT",
"语言":"Sprache","向量化":"Embedding","图片":"Bild","视频":"Video","识图":"Vision","语音":"Sprache",
"朱峰社区网站":"ZF-Community-Website","访问朱峰智能体网站":"zf3d.com besuchen",
"更多":"Mehr","更多菜单":"Mehr-Menü","提示":"Hinweis","确定":"OK","取消":"Abbrechen",
"整合下拉按钮":"Kombinierte Dropdown-Schaltfläche",
"演示 PPT":"Demo-PPT","已开启":"ein","已关闭":"aus","中文/EN":"中文/EN",
"朗读助手：开/关":"Vorlesen: ein/aus",
"游戏引擎":"Game-Engine","内置浏览器":"Integrierter Browser",
"新建对话":"Neuer Chat","设置 / 模型配置":"Einstellungen / Modellkonfiguration","切换语言":"Sprache wechseln",
"新会话":"Neue Sitzung","临时":"Temporär",
"停止":"Stopp","发送":"Senden","复制":"Kopieren","删除":"Löschen","编辑":"Bearbeiten",
"思考中…":"Denkt nach…","生成中…":"Generiert…"
};
var D=window.__I18N_DATA||(window.__I18N_DATA={});
var M=window.__I18N_MULTI||(window.__I18N_MULTI={});
if(!D.CN2EN)D.CN2EN={};if(!D.en)D.en={};
Object.keys(EN).forEach(function(k){var e=EN[k];
  if(D.CN2EN[k]===undefined||k==="朱峰社区无限")D.CN2EN[k]=e;
  if(D.en[k]===undefined||D.en[k]===k||k==="朱峰社区无限")D.en[k]=e;
});
M.ja=M.ja||{};M.ko=M.ko||{};M.de=M.de||{};
Object.keys(JA).forEach(function(k){if(M.ja[k]===undefined||M.ja[k]===k)M.ja[k]=JA[k];});
Object.keys(KO).forEach(function(k){if(M.ko[k]===undefined||M.ko[k]===k)M.ko[k]=KO[k];});
Object.keys(DE).forEach(function(k){if(M.de[k]===undefined||M.de[k]===k)M.de[k]=DE[k];});
/* ---- brand & common for ar/hi/es/fr/ru ---- */
var M2={
 ar:{'朱峰社区无限':'ZF3D AGENT','朱峰社区智能体':'ZF Community Agent','朱峰智能体无限':'ZF3D AGENT','朱峰社区无限':'ZF3D AGENT','语言':'اللغة','更多':'المزيد','更多菜单':'قائمة المزيد','提示':'تنبيه','确定':'موافق','取消':'إلغاء','游戏引擎':'محرك الألعاب','内置浏览器':'متصفح مدمج','新建对话':'محادثة جديدة','切换语言':'تغيير اللغة','停止':'إيقاف','发送':'إرسال','复制':'نسخ','删除':'حذف','编辑':'تحرير'},
 hi:{'朱峰社区无限':'ZF3D AGENT','朱峰社区智能体':'ZF Community Agent','朱峰智能体无限':'ZF3D AGENT','朱峰社区无限':'ZF3D AGENT','语言':'भाषा','更多':'और','更多菜单':'और मेनू','提示':'सूचना','确定':'ठीक है','取消':'रद्द करें','游戏引擎':'गेम इंजन','内置浏览器':'बिल्ट-इन ब्राउज़र','新建对话':'नई चैट','切换语言':'भाषा बदलें','停止':'रोकें','发送':'भेजें','复制':'कॉपी','删除':'हटाएं','编辑':'संपादित करें'},
 es:{'朱峰社区无限':'ZF3D AGENT','朱峰社区智能体':'ZF Community Agent','朱峰智能体无限':'ZF3D AGENT','朱峰社区无限':'ZF3D AGENT','语言':'Idioma','更多':'Más','更多菜单':'Menú adicional','提示':'Aviso','确定':'Aceptar','取消':'Cancelar','游戏引擎':'Motor de juegos','内置浏览器':'Navegador integrado','新建对话':'Nuevo chat','切换语言':'Cambiar idioma','停止':'Detener','发送':'Enviar','复制':'Copiar','删除':'Eliminar','编辑':'Editar'},
 fr:{'朱峰社区无限':'ZF3D AGENT','朱峰社区智能体':'ZF Community Agent','朱峰智能体无限':'ZF3D AGENT','朱峰社区无限':'ZF3D AGENT','语言':'Langue','更多':'Plus','更多菜单':'Menu supplémentaire','提示':'Avis','确定':'OK','取消':'Annuler','游戏引擎':'Moteur de jeu','内置浏览器':'Navigateur intégré','新建对话':'Nouvelle discussion','切换语言':'Changer de langue','停止':'Arrêter','发送':'Envoyer','复制':'Copier','删除':'Supprimer','编辑':'Modifier'},
 ru:{'朱峰社区无限':'ZF3D AGENT','朱峰社区智能体':'ZF Community Agent','朱峰智能体无限':'ZF3D AGENT','朱峰社区无限':'ZF3D AGENT','语言':'Язык','更多':'Ещё','更多菜单':'Доп. меню','提示':'Уведомление','确定':'ОК','取消':'Отмена','游戏引擎':'Игровой движок','内置浏览器':'Встроенный браузер','新建对话':'Новый чат','切换语言':'Сменить язык','停止':'Стоп','发送':'Отправить','复制':'Копировать','删除':'Удалить','编辑':'Изменить'}
};
Object.keys(M2).forEach(function(lg){M[lg]=M[lg]||{};Object.keys(M2[lg]).forEach(function(k){if(M[lg][k]===undefined||M[lg][k]===k)M[lg][k]=M2[lg][k];});});
['ja','ko','de','ar','hi','es','fr','ru'].forEach(function(lg){
  if(!M[lg+'__keep__'])M[lg+'__keep__']={};
  M[lg+'__keep__']['朱峰社区无限']=1;M[lg+'__keep__']['朱峰社区智能体']=1;M[lg+'__keep__']['朱峰社区无限']=1;M[lg+'__keep__']['朱峰智能体无限']=1;
});

/* 清理 v7 的错误污染：ja/ko/de 里纯英文值回退删除（下次回落英文/本地词条） */
['ja','ko','de'].forEach(function(lg){
  Object.keys(M[lg]).forEach(function(k){
    if(/^[A-Za-z0-9 :,.…\-\/'!?()&+]+$/.test(M[lg][k]) && !M[lg+'__keep__']?.[k]) delete M[lg][k];
  });
});
}catch(e){console.warn("i18n patch v8 err",e);}
})();
