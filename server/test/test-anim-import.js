// 兼容层快速验证：Unity .anim YAML + Spine JSON → OMA
const path = require("path");
const fs = require("fs");
const { AnimImporter, parseUnityAnim, unityToOMA } = require(path.join(__dirname, "..", "..", "public", "canvas", "engine2d", "anim-import.js"));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

// ---------- 1. Unity .anim YAML（标准顺序：path → attribute → curve）----------
const unityYaml = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_FloatCurves:
  - path: Arm_L
    attribute: m_LocalRotation
    curve:
      serializedVersion: 2
      m_Curve:
      - serializedVersion: 3
        time: 0
        value: {x: 0, y: 0, z: 0.08715574, w: 0.9961947}
      - serializedVersion: 3
        time: 0.5
        value: {x: 0, y: 0, z: 0.3826834, w: 0.9238795}
      - serializedVersion: 3
        time: 1
        value: {x: 0, y: 0, z: -0.2588190, w: 0.9659258}
  - path: Arm_L
    attribute: m_LocalPosition.x
    curve:
      m_Curve:
      - time: 0
        value: -0.5
      - time: 0.5
        value: 1.5
  m_SampleRate: 30
`;

console.log("[1] Unity .anim → OMA");
const curves = parseUnityAnim(unityYaml);
check("解析出 Arm_L 曲线", !!curves["Arm_L"]);
check("rotation 关键帧 3 个", curves["Arm_L"] && curves["Arm_L"].angle.length === 3);
// z=0.08715574,w=0.9961947 → 2*atan2 ≈ 10.0 deg
check("四元数→角度正确(~10°)", Math.abs(curves["Arm_L"].angle[0].v - 10) < 0.1);
const omaU = AnimImporter.load({ format: "unity", data: unityYaml, name: "wave" });
check("duration=1（修复后不再为0）", omaU.animations.clip.duration === 1);
const track = omaU.animations.clip.tracks["Arm_L"];
check("烘焙出 angle 数组", track && Array.isArray(track.angle) && track.angle.length === 16);
check("烘焙出 x 位移数组", Array.isArray(track.x) && track.x.length === 16);
check("角度采样首尾不同（非压扁曲线）", track.angle[0] !== track.angle[track.angle.length - 1]);
check("x 位移采样中点≈1.5", Math.abs(track.x[8] - 1.5) < 0.01);

// ---------- 2. Spine JSON ----------
console.log("[2] Spine JSON → OMA");
const spineJson = {
  skeleton: { name: "hero", width: 100 },
  bones: [
    { name: "root", parent: null, x: 0, y: 0, length: 0, rotation: 0 },
    { name: "torso", parent: "root", x: 0, y: 20, length: 30, rotation: 90 },
    { name: "legL", parent: "torso", x: 0, y: 10, length: 25, rotation: 0 },
  ],
  animations: {
    walk: {
      rotate: {
        legL: [{ time: 0, angle: 20 }, { time: 0.5, angle: -20 }, { time: 1, angle: 20 }],
      },
      translate: {
        torso: [{ time: 0, x: 0, y: 0 }, { time: 1, x: 5, y: 2 }],
      },
    },
  },
};
const omaS = AnimImporter.load(spineJson);
check("识别为 spine 并导入", omaS.name === "hero");
check("骨骼 3 根，父子链正确", omaS.bones.length === 3 && omaS.bones[2].parent === 1);
check("walk 动画 duration=1", omaS.animations.walk.duration === 1);
check("legL angle 烘焙 16 帧", omaS.animations.walk.tracks.legL.angle.length === 16);
check("torso x 位移末端=5", omaS.animations.walk.tracks.torso.x[15] === 5);

// ---------- 3. describe 自描述 ----------
console.log("[3] 自描述");
const d = AnimImporter.describe();
check("支持 3 种输入格式", d.supportedInputs.length === 3);

// ---------- 4. 保存样例 OMA（供大模型流程参考） ----------
fs.writeFileSync(path.join(__dirname, "sample-oma.json"), JSON.stringify(omaS, null, 2));
console.log("\n样例 OMA 已写入 server/test/sample-oma.json");
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
