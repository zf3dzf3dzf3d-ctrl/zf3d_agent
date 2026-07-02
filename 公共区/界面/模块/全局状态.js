/**
 * 全局状态 — 所有模块共享的变量
 * 从 逻辑.js 拆分，必须最先加载
 */

// ============ 全局状态 ============
let editorInstance = null;
let openFiles = [];     // [{path, name, content, dirty}]
let activeFileIdx = -1;

// ============ API鉴权（自动注入令牌到所有fetch请求） ============
const _原始fetch = window.fetch;
window.fetch = function(url, options = {}) {
    const token = localStorage.getItem("zf3d_auth_token");
    if (token && typeof url === "string" && url.startsWith("/api/")) {
        options.headers = options.headers || {};
        if (!options.headers["Authorization"]) {
            options.headers["Authorization"] = "Bearer " + token;
        }
    }
    return _原始fetch.call(this, url, options);
};
let currentRoot = null;
let currentRootDisplay = "";
let galleryPath = null;
let currentViewFile = null;
let galleryImages = [];
let currentImageIdx = -1;
let slideshowTimer = null;
let slideshowInterval = 3000;
let audioPlaylist = [];
let currentAudioIdx = -1;
let audioSeeking = false;
let videoPlaylist = [];
let currentVideoIdx = -1;
let galleryViewMode = localStorage.getItem("galleryView") || "grid";
let gallerySortKey = localStorage.getItem("gallerySortKey") || "名称";
let gallerySortAsc = localStorage.getItem("gallerySortAsc") !== "false";
let galleryItemsCache = [];
let galleryPageNum = 0;
const galleryPageSize = 200;
let logList = [];
let isChatting = false;
let chatAbortController = null;   // 对话中断控制器
let thinkingAnimTimer = null;     // 思考状态定时器
let editorSelection = null; // {text, start, end}
let selectedItems = new Map();  // 选中项: path -> {名称, 类型, 路径}
let diffMarkers = [];       // [{start, end, type:"add"|"del", text, timer}]
let reasoningPollTimer = null;   // 推理流轮询定时器
let reasoningIndex = 0;          // 推理流已读索引
let voiceEnabled = localStorage.getItem("voiceEnabled") === "true"; // 语音播报开关
let aiModifiedFiles = new Set();  // AI本轮修改过的文件路径集合（文件树高亮用）
