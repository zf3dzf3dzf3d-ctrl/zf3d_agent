const { AnimImporter, spineToOMA, parseUnityAnim, unityToOMA } = require("./anim-import.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("PASS", name); pass++; }
  catch (e) { console.log("FAIL", name, "-", e.message); fail++; }
}
function assert(c, m) { if (!c) throw new Error(m || "assert failed"); }

// 1. OMA 原生格式直通
const oma = {
  name: "t", fps: 12, loop: true,
  bones: [{ id: 0, name: "root", parent: -1, x: 0, y: 0, len: 20 }],
  animations: { walk: { duration: 1, tracks: { legL: { angle: [20, 45, 20, -5, 20] } } } },
};
t("oma passthrough", () => {
  const out = AnimImporter.load(oma);
  assert(out === oma);
});
t("format detect oma", () => assert(AnimImporter.detectFormat(oma) === "oma"));

// 2. Spine JSON
const spine = {
  skeleton: { name: "hero" },
  bones: [
    { name: "root" },
    { name: "torso", parent: "root", x: 0, y: 18, rotation: -90, length: 18 },
    { name: "legL", parent: "root", x: 0, y: 0, rotation: 20, length: 16 },
  ],
  slots: [],
  animations: {
    walk: {
      rotate: {
        legL: [{ time: 0, angle: 20 }, { time: 0.5, angle: -5 }, { time: 1.0, angle: 20 }],
      },
      translate: {
        torso: [{ time: 0, x: 0, y: 0 }, { time: 1.0, x: 5, y: 2 }],
      },
    },
  },
};
t("spine detect", () => assert(AnimImporter.detectFormat(spine) === "spine"));
t("spine convert", () => {
  const o = AnimImporter.load(spine);
  assert(o.name === "hero");
  assert(o.bones.length === 3);
  assert(o.bones[1].parent === 0 && o.bones[1].angle === -90);
  const walk = o.animations.walk;
  assert(walk.duration === 1);
  assert(Array.isArray(walk.tracks.legL.angle) && walk.tracks.legL.angle.length === 16);
  assert(walk.tracks.torso.y.length === 16 && walk.tracks.torso.x[15] === 5);
});

// 3. Unity .anim YAML
const yaml = `%YAML 1.1
AnimationClip:
  m_FloatCurves:
  - path: Hips/Torso
    attribute: m_LocalRotation
    curve:
      m_Keyframes:
      - value: {x: 0, y: 0, z: 0.3826834, w: 0.9238795}
        time: 0
      - value: {x: 0, y: 0, z: -0.08715574, w: 0.9961947}
        time: 1
  - path: Hips/Torso
    attribute: m_LocalPosition.y
    curve:
      m_Keyframes:
      - value: 0
        time: 0
      - value: 0.5
        time: 1
`;
t("unity detect", () => assert(AnimImporter.detectFormat(yaml) === "unity"));
t("unity convert", () => {
  const o = AnimImporter.load(yaml, { name: "clip1" });
  const clip = o.animations.clip;
  // 2*atan2(0.3826834, 0.9238795) ≈ 45°
  const first = clip.tracks.Torso.angle[0];
  assert(Math.abs(first - 45) < 0.5, "z rotation should be ~45, got " + first);
  assert(clip.tracks.Torso.y[15] === 0.5);
  assert(o.name === "clip1");
});

// 4. describe 自描述
t("describe", () => {
  const d = AnimImporter.describe();
  assert(d.supportedInputs.length === 3);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
