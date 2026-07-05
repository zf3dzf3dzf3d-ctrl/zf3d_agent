/**
 * 音乐播放器 — 底部播放栏 + 播放列表
 * 从推理流"播放音乐"事件触发
 */

let mbPlaylist = [];        // [{路径, 歌名, 歌手, 封面, 来源}]
let mbCurrentIdx = -1;      // 当前播放索引
let mbSeeking = false;      // 是否在拖拽进度条

function _确保编辑器面板可见() {
    const ep = document.getElementById("editorPanel");
    if (ep && ep.classList.contains("hidden")) {
        const btn = document.getElementById("toggleEditor");
        if (btn) btn.click();
    }
}

function _显示播放器() {
    _确保编辑器面板可见();
    document.getElementById("musicBar").style.display = "flex";
}

function initMusicBar() {
    const audio = document.getElementById("mbAudio");
    const progress = document.getElementById("mbProgress");
    const fill = document.getElementById("mbProgressFill");
    const handle = document.getElementById("mbProgressHandle");

    audio.addEventListener("loadedmetadata", () => {
        document.getElementById("mbTotalTime").textContent = formatTime(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
        if (mbSeeking) return;
        const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
        fill.style.width = pct + "%";
        handle.style.left = pct + "%";
        document.getElementById("mbCurrentTime").textContent = formatTime(audio.currentTime);
    });
    audio.addEventListener("ended", () => { mbNext(); });
    audio.addEventListener("play", () => { document.getElementById("mbPlayBtn").textContent = "⏸"; });
    audio.addEventListener("pause", () => { document.getElementById("mbPlayBtn").textContent = "▶"; });

    // 进度条拖拽
    let dragging = false;
    function seekTo(e) {
        const rect = progress.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (audio.duration) audio.currentTime = pct * audio.duration;
        fill.style.width = (pct * 100) + "%";
        handle.style.left = (pct * 100) + "%";
    }
    progress.addEventListener("mousedown", (e) => { mbSeeking = true; dragging = true; seekTo(e); });
    document.addEventListener("mousemove", (e) => { if (dragging) seekTo(e); });
    document.addEventListener("mouseup", () => { if (dragging) { dragging = false; mbSeeking = false; } });

    // 音量滑块
    const volSlider = document.getElementById("mbVolSlider");
    if (volSlider) {
        volSlider.addEventListener("input", () => {
            const audio = document.getElementById("mbAudio");
            const v = volSlider.value / 100;
            audio.volume = v;
            const icon = document.getElementById("mbVolIcon");
            const pct = Math.round(v * 100);
            icon.textContent = pct == 0 ? "🔇" : (pct < 50 ? "🔉" : "🔊");
            icon.title = `音量: ${pct}%`;
        });
    }

    // 键盘空格
    document.addEventListener("keydown", (e) => {
        if (e.code === "Space" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT") {
            if (document.getElementById("musicBar").style.display !== "none") {
                e.preventDefault(); mbToggle();
            }
        }
    });
}

function mbPlaySong(路径, 歌名, 歌手, 封面, 来源, 添加到列表, 播放URL, bvid) {
    // 支持三种模式：B站BV号(实时获取音频流) / 本地文件 / 直接URL
    let audioURL;
    if (bvid) {
        audioURL = `/api/music-proxy?bvid=${encodeURIComponent(bvid)}`;
    } else if (播放URL) {
        audioURL = `/api/music-proxy?url=${encodeURIComponent(播放URL)}`;
    } else if (路径) {
        audioURL = `/api/audio?path=${encodeURIComponent(路径)}`;
    } else {
        showToast("error", "❌ 无法播放", "未找到音频源");
        return;
    }

    // 去重
    const existIdx = mbPlaylist.findIndex(s => s.歌名 === 歌名 && s.歌手 === 歌手);
    if (existIdx >= 0) {
        if (!添加到列表) {
            mbCurrentIdx = existIdx;
            mbPlay();
        }
        return;
    }

    if (添加到列表) {
        mbPlaylist.push({ 路径: 路径 || "", 歌名, 歌手, 封面: 封面 || "", 来源: 来源 || "", 播放URL: 播放URL || "", bvid: bvid || "" });
        mbRenderPlaylist();
        return;
    }
    mbPlaylist.push({ 路径: 路径 || "", 歌名, 歌手, 封面: 封面 || "", 来源: 来源 || "", 播放URL: 播放URL || "", bvid: bvid || "" });
    mbCurrentIdx = mbPlaylist.length - 1;
    mbPlay();
}

function mbPlay() {
    if (mbCurrentIdx < 0 || mbCurrentIdx >= mbPlaylist.length) return;
    const song = mbPlaylist[mbCurrentIdx];
    const audio = document.getElementById("mbAudio");
    document.getElementById("mbName").textContent = song.歌名;
    document.getElementById("mbArtist").textContent = song.歌手;
    const cover = document.getElementById("mbCover");
    cover.textContent = "🎵";

    // 如果有本地文件路径，直接播放
    if (song.路径) {
        audio.src = `/api/audio?path=${encodeURIComponent(song.路径)}`;
        audio.play().catch(() => {
            showToast("info", "🎵 点击播放", "浏览器限制了自动播放，请点击播放按钮▶");
        });
        _显示播放器();
        mbRenderPlaylist();
        mbUpdateNavBtns();
        return;
    }

    // 没有本地文件，有bvid → 按需下载
    if (song.bvid) {
        document.getElementById("mbArtist").textContent = "⏳ 下载中...";
        showToast("info", "⏳ 下载中", song.歌名);
        fetch(`/api/music-download?bvid=${encodeURIComponent(song.bvid)}&name=${encodeURIComponent(song.歌名)}`)
            .then(r => r.json())
            .then(d => {
                if (d.成功) {
                    song.路径 = d.文件路径;
                    document.getElementById("mbArtist").textContent = song.歌手;
                    audio.src = `/api/audio?path=${encodeURIComponent(d.文件路径)}`;
                    audio.play().catch(() => {
                        showToast("info", "🎵 点击播放", "浏览器限制了自动播放，请点击播放按钮▶");
                    });
                } else {
                    document.getElementById("mbArtist").textContent = "❌ 下载失败";
                    showToast("error", "❌ 下载失败", d.错误 || "未知错误");
                }
            })
            .catch(e => {
                document.getElementById("mbArtist").textContent = "❌ 下载失败";
                showToast("error", "❌ 下载失败", String(e));
            });
        _显示播放器();
        mbRenderPlaylist();
        mbUpdateNavBtns();
        return;
    }

    showToast("error", "❌ 无法播放", "未找到音频源");
}

function mbToggle() {
    const audio = document.getElementById("mbAudio");
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
}

function mbPrev() {
    if (mbPlaylist.length === 0) return;
    mbCurrentIdx = (mbCurrentIdx - 1 + mbPlaylist.length) % mbPlaylist.length;
    mbPlay();
}

function mbNext() {
    if (mbPlaylist.length === 0) return;
    mbCurrentIdx = (mbCurrentIdx + 1) % mbPlaylist.length;
    mbPlay();
}

function mbToggleVolumePopup() {
    const popup = document.getElementById("mbVolPopup");
    popup.style.display = popup.style.display === "none" ? "block" : "none";
}

function mbSetVolume(v) {
    const audio = document.getElementById("mbAudio");
    const icon = document.getElementById("mbVolIcon");
    const slider = document.getElementById("mbVolSlider");
    v = Math.max(0, Math.min(1, v));
    audio.volume = v;
    if (slider) slider.value = Math.round(v * 100);
    const pct = Math.round(v * 100);
    icon.textContent = pct == 0 ? "🔇" : (pct < 50 ? "🔉" : "🔊");
    icon.title = `音量: ${pct}%`;
}

function mbToggleMute() {
    const audio = document.getElementById("mbAudio");
    if (audio.volume > 0) {
        audio._lastVolume = audio.volume;
        mbSetVolume(0);
    } else {
        mbSetVolume(audio._lastVolume || 1);
    }
}

function mbUpdateNavBtns() {
    document.getElementById("mbPrevBtn").style.display = mbPlaylist.length > 1 ? "" : "none";
    document.getElementById("mbNextBtn").style.display = mbPlaylist.length > 1 ? "" : "none";
    document.getElementById("mbCount").textContent = mbPlaylist.length > 1 ? `${mbCurrentIdx + 1}/${mbPlaylist.length}` : "";
}

function mbTogglePlaylist() {
    const panel = document.getElementById("mbPlaylistPanel");
    panel.style.display = panel.style.display === "none" ? "flex" : "none";
}

function mbRenderPlaylist() {
    const list = document.getElementById("mbPlaylistItems");
    list.innerHTML = "";
    mbPlaylist.forEach((song, i) => {
        const item = document.createElement("div");
        item.className = "mb-pl-item" + (i === mbCurrentIdx ? " active" : "");
        item.innerHTML = `
            <span class="mb-pl-icon">${i === mbCurrentIdx ? "🎵" : "🎶"}</span>
            <span class="mb-pl-name">${escapeHtml(song.歌名)}</span>
            <span class="mb-pl-artist">${escapeHtml(song.歌手)}</span>
            <button class="mb-pl-del" onclick="mbRemoveFromPlaylist(${i})">✕</button>
        `;
        item.addEventListener("click", (e) => {
            if (e.target.classList.contains("mb-pl-del")) return;
            mbCurrentIdx = i;
            mbPlay();
        });
        list.appendChild(item);
    });
}

function mbRemoveFromPlaylist(idx) {
    if (idx === mbCurrentIdx) {
        const audio = document.getElementById("mbAudio");
        audio.pause();
    }
    mbPlaylist.splice(idx, 1);
    if (idx < mbCurrentIdx) {
        mbCurrentIdx--;
    } else if (idx === mbCurrentIdx) {
        if (mbCurrentIdx >= mbPlaylist.length) mbCurrentIdx = 0;
        if (mbPlaylist.length > 0) mbPlay();
        else document.getElementById("musicBar").style.display = "none";
    }
    mbRenderPlaylist();
    mbUpdateNavBtns();
}

function mbClose() {
    const audio = document.getElementById("mbAudio");
    audio.pause();
    document.getElementById("musicBar").style.display = "none";
    document.getElementById("mbPlaylistPanel").style.display = "none";
}
