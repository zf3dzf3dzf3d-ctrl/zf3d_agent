# 2D 全自动角色骨骼动画管线

目标：输入一张 AI 生成的角色图 → 自动抠背景 → 自动拆件 → 自动生成骨骼 → 自动绑定呼吸/待机/眨眼动画 → 浏览器播放验证。

## 管线流程

```
input.png
  │ cutout.py        (rembg 抠背景 → 透明 PNG)
  ▼
cutout.png
  │ split_parts.py   (alpha/连通域+启发式拆件 → parts/*.png + parts.json)
  ▼
parts/
  │ build_rig.py     (按部件位置生成骨骼层级 → skeleton.json)
  ▼
skeleton.json
  │ build_anim.py    (生成呼吸/待机/眨眼关键帧 → animation.json)
  ▼
animation.json
  │ viewer.html      (Canvas 播放器实时播放)
  ▼
浏览器验收
```

## 技术选型

- 抠图：rembg (u2net，首次运行自动下载模型)
- 拆件：alpha 通道 + 连通域分析 + 水平/垂直投影启发式（无 GPU 也能跑；SAM 留作增强项）
- 骨骼/动画：自研 JSON 格式（结构与 Spine 兼容思想：bone 层级 + slot/skin 贴图 + 时间轴关键帧）
- 播放器：纯 HTML5 Canvas，无外部依赖

## 用法

```
python scripts/cutout.py assets/input.png
python scripts/split_parts.py output/cutout.png
python scripts/build_rig.py output/parts.json
python scripts/build_anim.py output/skeleton.json
# 打开 output/viewer.html 查看
```
