// test-tilemap.js — 瓦片地图无头测试
"use strict";
const { TileMap } = require("./tilemap.js");
let pass = 0, fail = 0;
function t(name, cond) { cond ? (pass++, console.log("PASS " + name)) : (fail++, console.log("FAIL " + name)); }

// 精简格式 10x10，两层
const data = {
  w: 10, h: 10, tileSize: 32,
  layers: [
    { name: "ground", data: new Array(100).fill(0) },
    { name: "collision", solid: true, data: new Array(100).fill(0) }
  ]
};
const m = new TileMap(JSON.parse(JSON.stringify(data)));

// set/get 一致性（x=4,y=5 → 索引 y*w+x=54）
m.set(4, 5, 7, 0);
t("set(4,5,7) → get(4,5)==7", m.get(4, 5, 0) === 7);
t("索引为行主序 data[y*w+x]", m.layers[0].data[5 * 10 + 4] === 7);
t("越界 get 返回 0", m.get(-1, 0) === 0 && m.get(0, -1) === 0 && m.get(10, 10) === 0);
t("越界 set 不抛错", (m.set(-5, -5, 9), m.set(99, 99, 9), true));

// solidAt 像素坐标
m.set(3, 2, 1, 1);
t("solidAt(3*32+5, 2*32+5)==true", m.solidAt(101, 69) === true);
t("solidAt(0,0)==false（空地）", m.solidAt(0, 0) === false);
t("solidAt 越界像素==false", m.solidAt(9999, 9999) === false);

// hitRect AABB 碰撞
t("hitRect 覆盖实心块==true", m.hitRect(96, 64, 32, 32) === true);
t("hitRect 空地==false", m.hitRect(0, 0, 32, 32) === false);
t("hitRect 边缘擦边==false", m.hitRect(0, 0, 96, 64) === false); // 到 x=95,y=63，未触及 (3,2)
t("hitRect 压线实心块==true", m.hitRect(64, 32, 64, 64) === true); // 覆盖到 x=3, y=2

// Tiled JSON 兼容
const tiled = {
  width: 4, height: 3, tilewidth: 16,
  tilesets: [{ firstgid: 1, image: "tiles.png", imagewidth: 64, tileheight: 16, columns: 4 }],
  layers: [
    { name: "ground", type: "tilelayer", data: [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0] },
    { name: "collision", type: "tilelayer", data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5] }
  ]
};
const tm = new TileMap(tiled);
t("Tiled: 尺寸转换 4x3", tm.w === 4 && tm.h === 3 && tm.ts === 16);
t("Tiled: firstgid 偏移修正", tm.get(0, 0, 0) === 0 && tm.get(1, 1, 0) === 1 && tm.get(2, 2, 0) === 2);
t("Tiled: collision 层按名识别", tm.layers[1].solid === true && tm.layers[0].solid === false);
t("Tiled: 图集列数计算", tm.atlas && tm.atlas.cols === 4);
t("Tiled: solidAt 命中 gid=5", tm.solidAt(3 * 16 + 1, 2 * 16 + 1) === true);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
