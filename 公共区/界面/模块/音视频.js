/**
 * 音视频 — 音频播放器+视频播放器
 * 从 逻辑.js 拆分
 */

// ============ 音频播放器 ============
function showAudio(fullPath, name, idx) {
    stopSlideshow();
    currentViewFile = { 路径: fullPath, 名称: name, 类型: "音频" };
    showMediaView();
    const mv = document.getElementById("mediaView");
    mv.style.overflowY = "auto";
    mv.style.padding = "12px";
    document.getElementById("galleryGrid").style.display = "none";
    document.getElementById("galleryList").style.display = "none";
    document.getElementById("galleryHeader").style.display = "none";
    document.getElementById("imageViewer").style.display = "none";
    document.getElementById("videoPlayer").style.display = "none";
    document.getElementById("audioPlayer").style.display = "flex";

    currentAudioIdx = idx >= 0 ? idx : audioPlaylist.findIndex(a => a.路径 === fullPath);
    document.getElementById("audioFileName").textContent = name;
    const audio = document.getElementById("audioElement");
    audio.src = `/api/audio?path=${encodeURIComponent(fullPath)}`;
    audio.play().catch(() => {});
    updateAudioPlayBtn(true);
    updateAudioNavBtns();
}

function initAudioPlayer() {
    const audio = document.getElementById("audioElement");
    const progress = document.getElementById("audioProgress");
    const fill = document.getElementById("audioProgressFill");
    const handle = document.getElementById("audioProgressHandle");
    const volumeSlider = document.getElementById("audioVolumeSlider");

    audio.addEventListener("loadedmetadata", () => {
        document.getElementById("audioTotalTime").textContent = formatTime(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
        if (audioSeeking) return;
        const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
        fill.style.width = pct + "%";
        handle.style.left = pct + "%";
        document.getElementById("audioCurrentTime").textContent = formatTime(audio.currentTime);
    });
    audio.addEventListener("ended", () => { updateAudioPlayBtn(false); });
    audio.addEventListener("play", () => { updateAudioPlayBtn(true); });
    audio.addEventListener("pause", () => { updateAudioPlayBtn(false); });

    // 进度条拖拽seek
    let dragging = false;
    function seekTo(e) {
        const rect = progress.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (audio.duration) audio.currentTime = pct * audio.duration;
        fill.style.width = (pct * 100) + "%";
        handle.style.left = (pct * 100) + "%";
    }
    progress.addEventListener("mousedown", (e) => {
        audioSeeking = true; dragging = true; seekTo(e);
    });
    document.addEventListener("mousemove", (e) => { if (dragging) seekTo(e); });
    document.addEventListener("mouseup", () => { if (dragging) { dragging = false; audioSeeking = false; } });

    // 音量控制
    volumeSlider.addEventListener("input", () => {
        audio.volume = volumeSlider.value / 100;
        document.getElementById("audioVolumeIcon").textContent = audio.volume == 0 ? "🔇" : (audio.volume < 0.5 ? "🔉" : "🔊");
    });

    // 键盘空格播放/暂停
    document.addEventListener("keydown", (e) => {
        if (document.getElementById("audioPlayer").style.display === "none") return;
        if (e.code === "Space" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT") {
            e.preventDefault(); toggleAudioPlay();
        }
    });
}

function toggleAudioPlay() {
    const audio = document.getElementById("audioElement");
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
}

function updateAudioPlayBtn(playing) {
    document.getElementById("audioPlayBtn").textContent = playing ? "⏸" : "▶";
}

function updateAudioNavBtns() {
    const prevBtn = document.getElementById("audioPrevBtn");
    const nextBtn = document.getElementById("audioNextBtn");
    prevBtn.style.display = audioPlaylist.length > 1 ? "" : "none";
    nextBtn.style.display = audioPlaylist.length > 1 ? "" : "none";
}

function prevAudio() {
    if (audioPlaylist.length === 0) return;
    currentAudioIdx = (currentAudioIdx - 1 + audioPlaylist.length) % audioPlaylist.length;
    const a = audioPlaylist[currentAudioIdx];
    const audio = document.getElementById("audioElement");
    document.getElementById("audioFileName").textContent = a.名称;
    audio.src = `/api/audio?path=${encodeURIComponent(a.路径)}`;
    audio.play().catch(() => {});
}

function nextAudio() {
    if (audioPlaylist.length === 0) return;
    currentAudioIdx = (currentAudioIdx + 1) % audioPlaylist.length;
    const a = audioPlaylist[currentAudioIdx];
    const audio = document.getElementById("audioElement");
    document.getElementById("audioFileName").textContent = a.名称;
    audio.src = `/api/audio?path=${encodeURIComponent(a.路径)}`;
    audio.play().catch(() => {});
}

function toggleMute() {
    const audio = document.getElementById("audioElement");
    const slider = document.getElementById("audioVolumeSlider");
    if (audio.volume > 0) {
        audio._lastVolume = audio.volume;
        audio.volume = 0; slider.value = 0;
        document.getElementById("audioVolumeIcon").textContent = "🔇";
    } else {
        const v = audio._lastVolume || 1;
        audio.volume = v; slider.value = v * 100;
        document.getElementById("audioVolumeIcon").textContent = v < 0.5 ? "🔉" : "🔊";
    }
}

function formatTime(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function hideAudioPlayer() {
    const audio = document.getElementById("audioElement");
    if (!audio.paused) audio.pause();
    document.getElementById("audioPlayer").style.display = "none";
}

// ============ 视频播放器 ============
function showVideo(fullPath, name, idx) {
    stopSlideshow();
    hideAudioPlayer();
    currentViewFile = { 路径: fullPath, 名称: name, 类型: "视频" };
    showMediaView();
    const mv = document.getElementById("mediaView");
    mv.style.overflowY = "hidden";
    mv.style.padding = "0";
    document.getElementById("galleryGrid").style.display = "none";
    document.getElementById("galleryList").style.display = "none";
    document.getElementById("galleryHeader").style.display = "none";
    document.getElementById("imageViewer").style.display = "none";
    document.getElementById("audioPlayer").style.display = "none";
    document.getElementById("videoPlayer").style.display = "flex";
    document.getElementById("videoFileName").textContent = name;
    currentVideoIdx = idx >= 0 ? idx : videoPlaylist.findIndex(v => v.路径 === fullPath);
    updateVideoNavBtns();
    const video = document.getElementById("videoElement");
    video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
    video.style.transform = "";
    video.src = `/api/video?path=${encodeURIComponent(fullPath)}`;
    video.play().catch(() => {});
}

function updateVideoNavBtns() {
    const prevBtn = document.getElementById("videoPrevBtn");
    const nextBtn = document.getElementById("videoNextBtn");
    const counter = document.getElementById("videoCounter");
    if (videoPlaylist.length > 1 && currentVideoIdx >= 0) {
        prevBtn.style.display = "";
        nextBtn.style.display = "";
        counter.textContent = `${currentVideoIdx + 1} / ${videoPlaylist.length}`;
    } else {
        prevBtn.style.display = "none";
        nextBtn.style.display = "none";
        counter.textContent = "";
    }
}

function prevVideo() {
    if (videoPlaylist.length === 0) return;
    currentVideoIdx = (currentVideoIdx - 1 + videoPlaylist.length) % videoPlaylist.length;
    const v = videoPlaylist[currentVideoIdx];
    const video = document.getElementById("videoElement");
    video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
    video.style.transform = "";
    video.src = `/api/video?path=${encodeURIComponent(v.路径)}`;
    document.getElementById("videoFileName").textContent = v.名称;
    updateVideoNavBtns();
    video.play().catch(() => {});
}

function nextVideo() {
    if (videoPlaylist.length === 0) return;
    currentVideoIdx = (currentVideoIdx + 1) % videoPlaylist.length;
    const v = videoPlaylist[currentVideoIdx];
    const video = document.getElementById("videoElement");
    video.dataset.x = 0; video.dataset.y = 0; video.dataset.scale = 1;
    video.style.transform = "";
    video.src = `/api/video?path=${encodeURIComponent(v.路径)}`;
    document.getElementById("videoFileName").textContent = v.名称;
    updateVideoNavBtns();
    video.play().catch(() => {});
}

function hideVideoPlayer() {
    const video = document.getElementById("videoElement");
    if (!video.paused) video.pause();
    video.removeAttribute("src");
    video.load();
    document.getElementById("videoPlayer").style.display = "none";
}

function hideDocViewer() {
    document.getElementById("docViewer").style.display = "none";
    const el = document.getElementById("docContent");
    while (el.firstChild) el.removeChild(el.firstChild);
}

