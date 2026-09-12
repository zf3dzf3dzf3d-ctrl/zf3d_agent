# AI 视频剪辑能力 使用文档

## 概述
对标 GitHub 上 MoneyPrinterTurbo / FunClip 的核心链路，全部本地运行（无 API 依赖）：
- **FFmpeg 8.0.1**：剪切/拼接/转码/抽帧/混音/变速等 17 个基础函数
- **faster-whisper**：语音转写 → SRT 字幕（支持 tiny~large-v3，中文推荐 small）
- **pySceneDetect + 响度分析**：场景切分、高光打分、静音检测、自动粗剪
- **edge-tts**：中文配音 → 文案一键成片

## 文件结构
- `server/video/video_tools.py` — FFmpeg 基础能力 17 函数
- `server/video/subtitle_ai.py` — Whisper 转写 + SRT + 烧录
- `server/video/smart_edit.py` — 场景/静音/高光智能剪辑
- `server/video/auto_producer.py` — 文案成片一键管线
- `server/video/fx_cut.py` — 转场特效（16种 xfade）+ BGM 节拍卡点 + 淡入淡出
- `server/video/material_match.py` — 素材自动搜配（jieba 关键词 + 素材库索引）
- `server/video/visual_score.py` — 多模态选片（视觉画面打分 + 音画融合高光）
- `server/video/test_*.py` / `e2e_test.py` — 测试脚本
- `tools/minimal/backend/video_edit.py` — 智能体工具后端（统一入口）
- `public/js/tools-defs-media.js` — 前端工具定义

## 智能体调用（对话中直接说）
「帮这个视频加字幕」「提取高光」「去掉停顿」「用这段文案做个口播视频」等。

## video_edit 工具 action 一览
| action | 功能 | 关键参数 |
|---|---|---|
| info | 元信息 | file |
| cut | 剪切 | file, start, end, out |
| concat | 拼接 | paths[], out |
| subtitle | 转写+SRT（burn=true 烧录） | file, model(tiny~large-v3), lang, burn, out |
| analyze | 场景+静音+响度分析 | file, compact |
| highlight | 高光合集 | file, top, window |
| desilence | 去静音粗剪 | file, noise_db |
| speed / volume / mix / text / gif / shot | 变速/音量/混BGM/水印/GIF/截图 | … |
| produce | 文案成片：TTS+素材+字幕+BGM | text, materials[], voice, bgm, size |
| transition | 两段视频加转场（16种：fade/wipe/slide/circle/dissolve/zoomin…） | file, file2, kind, duration |
| beat_sync | 卡点视频：检测BGM节拍自动切换素材 | clips[], bgm, mode, max_out |
| fade | 淡入淡出 | file, fin, fout |
| auto_materials | 素材自动搜配：按文案关键词匹配素材库 | texts, lib |
| visual_highlight | 多模态选片：音画融合高光（音频60%+视觉40%） | file, top, window, audio_weight |
| vision_pick | AI识图选片：视觉大模型逐帧打分挑高光。fps 可为数字（每秒抽几帧，如 1/0.5/2）或 'auto'（AI 先看概览图自己决定抽帧密度和挑选重点） | file, fps(auto), prompt, top_ratio, max_frames, vision_model, out |

## 已验证（全部实测）
- 中文语音转写（small, language=zh, 概率 1.0）→ SRT → 烧录 ✅
- 三场景视频：场景切分正确、高光命中切换点、粗剪输出 ✅
- 两段文案一键成片 7.5s（渐变背景+配音+字幕）✅
- 智能体工具端到端：info/analyze/highlight/desilence/cut/subtitle 全 PASS ✅
- 转场/淡入淡出/卡点：xfade circleopen、fade、beat_sync 输出实测 ✅（test_fx.py）
- 素材搜配：jieba 关键词索引，3 段文案全部匹配正确素材 ✅（test_material.py）
- 多模态选片：运动段分数 0.59 > 静止段 0.20，音画融合高光输出 ✅（test_visual.py）
- 后端新 action 端到端：transition/fade/beat_sync/auto_materials/visual_highlight 全 PASS ✅（test_backend_new.py）

## 注意
- file 参数请用绝对路径或相对项目根的路径
- 无音轨的视频不能转写字幕（会报错，属正常）
- produce 无素材时自动用渐变背景占位
