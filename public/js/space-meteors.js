/**
 * 无限画布 - 流星效果
 * 偶尔、少量出现的流星（约每 4-10 秒一颗）
 */
(function () {
    'use strict';

    const canvas = document.getElementById('canvasArea');
    if (!canvas) return;

    // 页面隐藏时暂停
    let isVisible = !document.hidden;
    document.addEventListener('visibilitychange', () => {
        isVisible = !document.hidden;
    });

    // 随机间隔 4-10 秒
    function nextDelay() {
        return 4000 + Math.random() * 6000;
    }

    // 15% 概率来一小波（1~2 颗连发）
    function maybeBurst() {
        return Math.random() < 0.15;
    }

    function spawnMeteor() {
        if (!isVisible) return;

        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        // 起点：画面上半部分
        const startX = Math.random() * w * 0.6;
        const startY = Math.random() * h * 0.3;

        // 飞行距离（跨越画面 30-60%）
        const distance = Math.min(w, h) * (0.3 + Math.random() * 0.3);
        const angleDeg = 25 + Math.random() * 20;
        const angleRad = angleDeg * Math.PI / 180;
        const dx = Math.cos(angleRad) * distance;
        const dy = Math.sin(angleRad) * distance;

        // 持续 0.8 ~ 1.6 秒
        const duration = 800 + Math.random() * 800;

        // 大小：20% 概率较大
        const isBig = Math.random() < 0.2;
        const size = isBig ? 2.5 : 1.5 + Math.random() * 1;

        // 颜色：白为主，少量蓝/粉
        const colorRand = Math.random();
        let coreColor = '#ffffff';
        if (colorRand < 0.15) coreColor = '#b8d4ff';
        else if (colorRand < 0.25) coreColor = '#ffd9f0';

        const el = document.createElement('div');
        el.className = 'space-meteor';
        el.style.left = startX + 'px';
        el.style.top = startY + 'px';
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.background = coreColor;
        el.style.boxShadow = '0 0 ' + (size * 4) + 'px ' + size + 'px ' + coreColor +
            ', 0 0 ' + (size * 8) + 'px ' + (size * 1.5) + 'px ' + coreColor + '80';
        el.style.setProperty('--angle', angleDeg + 'deg');
        el.style.setProperty('--dx', dx + 'px');
        el.style.setProperty('--dy', dy + 'px');
        el.style.animationDuration = duration + 'ms';
        el.classList.add('meteor-anim');

        canvas.appendChild(el);

        el.addEventListener('animationend', () => {
            el.classList.add('meteor-done');
            if (el.parentNode) el.parentNode.removeChild(el);
        }, { once: true });
    }

    function schedule() {
        if (!isVisible) {
            setTimeout(schedule, 2000);
            return;
        }
        spawnMeteor();

        if (maybeBurst()) {
            const burstCount = 1 + Math.floor(Math.random() * 2);
            for (let i = 0; i < burstCount; i++) {
                setTimeout(spawnMeteor, 150 + Math.random() * 350);
            }
        }

        setTimeout(schedule, nextDelay());
    }

    // 首次延迟 2 秒（让星空先稳定）
    setTimeout(schedule, 2000);
})();
