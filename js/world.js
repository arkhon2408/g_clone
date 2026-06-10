'use strict';
// ---------------------------------------------------------------------------
// world.js — the Colony valley: terrain, Old Camp, forest, lake, mine, ruin.
// ---------------------------------------------------------------------------

const WORLD = {
  mesh: null,
  waterMesh: null,
  colliders: [],   // {x, z, r}
  fires: [],       // {x, y, z, big}
  nodes: [],       // gather nodes: dry pines, stone blocks, the ore vein
  nodeMeshes: {},
  size: 160,
  waterLevel: 1.2,
  barrierR: 150,
  campR: 34,
};

// Dirt paths (polyline segments), used for terrain coloring.
const PATHS = [
  [[0, 36], [0, 62]],
  [[0, 62], [14, 86]],
  [[14, 86], [28, 102]],
  [[0, 62], [-28, 66]],
  [[-28, 66], [-58, 62]],
  [[0, -34], [0, -80]],
  [[0, -80], [0, -116]],
];

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}
function distToPath(x, z) {
  let d = 1e9;
  for (const s of PATHS) {
    d = Math.min(d, distToSeg(x, z, s[0][0], s[0][1], s[1][0], s[1][1]));
  }
  return d;
}

function terrainH(x, z) {
  const r = Math.hypot(x, z);
  let h = 4
    + 1.5 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 + 0.7)
    + 0.8 * Math.sin(x * 0.11 + 4.0) * Math.sin(z * 0.13 + 2.0)
    + 0.35 * Math.sin(x * 0.31) * Math.cos(z * 0.27);
  // ring of mountains closing the valley
  const m = smoothstep(102, 155, r);
  h += m * m * 62 + m * 9 * Math.abs(Math.sin(x * 0.05) * Math.cos(z * 0.06));
  // flatten the Old Camp plateau
  const f = smoothstep(34, 50, r);
  h = lerp(4.2, h, f);
  // lake basin in the south-west
  const dl = Math.hypot(x + 70, z - 60);
  h -= 7.5 * Math.exp(-(dl / 18) * (dl / 18));
  // paths are slightly sunken from years of digger boots
  const pd = distToPath(x, z);
  if (pd < 6 && r < 110) {
    h -= smoothstep(6, 2.5, pd) * 0.15;
  }
  return h;
}

function terrainNormalY(x, z) {
  const e = 1.2;
  const hx = terrainH(x + e, z) - terrainH(x - e, z);
  const hz = terrainH(x, z + e) - terrainH(x, z - e);
  return 2 * e / Math.hypot(hx, 2 * e, hz);
}

function terrainColor(x, z, h) {
  const n = hash2(Math.floor(x * 0.7), Math.floor(z * 0.7));
  let col = [0.27 + n * 0.07, 0.40 + n * 0.07, 0.17 + n * 0.04]; // grass
  // dirt paths
  const pd = distToPath(x, z);
  const pf = smoothstep(4.5, 1.8, pd);
  col = [lerp(col[0], 0.42, pf), lerp(col[1], 0.32, pf), lerp(col[2], 0.20, pf)];
  // camp ground is trodden dirt
  const cf = smoothstep(36, 28, Math.hypot(x, z));
  col = [lerp(col[0], 0.40, cf * 0.8), lerp(col[1], 0.31, cf * 0.8), lerp(col[2], 0.20, cf * 0.8)];
  // rock on steep slopes
  const steep = 1 - terrainNormalY(x, z);
  const rf = smoothstep(0.22, 0.45, steep);
  col = [lerp(col[0], 0.43 + n * 0.05, rf), lerp(col[1], 0.41 + n * 0.05, rf), lerp(col[2], 0.39 + n * 0.05, rf)];
  // snow high up
  const sf = smoothstep(46, 58, h);
  col = [lerp(col[0], 0.85, sf), lerp(col[1], 0.86, sf), lerp(col[2], 0.92, sf)];
  // sand at the waterline
  const wf = smoothstep(WORLD.waterLevel + 1.5, WORLD.waterLevel + 0.2, h);
  col = [lerp(col[0], 0.52, wf), lerp(col[1], 0.46, wf), lerp(col[2], 0.30, wf)];
  return col;
}

// ---- structures ------------------------------------------------------------

const COL_WOOD = [0.36, 0.26, 0.16];
const COL_WOOD_DK = [0.28, 0.20, 0.12];
const COL_STONE = [0.42, 0.40, 0.38];
const COL_ROOF = [0.45, 0.30, 0.18];

function addTree(g, x, z, rng) {
  const y = terrainH(x, z);
  const s = 0.8 + rng() * 0.7;
  const gr = 0.16 + rng() * 0.08;
  addCylinder(g, x, y - 0.3, z, 0.22 * s, 1.8 * s, 5, COL_WOOD_DK);
  const green = [0.10 + rng() * 0.05, 0.26 + rng() * 0.08, 0.10 + rng() * 0.04];
  addCylinder(g, x, y + 1.2 * s, z, 1.6 * s, 2.4 * s, 7, green, 0);
  addCylinder(g, x, y + 2.7 * s, z, 1.15 * s, 2.0 * s, 7, [green[0] + gr * 0.2, green[1] + gr * 0.3, green[2]], 0);
  addCylinder(g, x, y + 4.0 * s, z, 0.75 * s, 1.6 * s, 7, green, 0);
  WORLD.colliders.push({ x: x, z: z, r: 0.55 * s });
}

function addRock(g, x, z, rng) {
  const y = terrainH(x, z);
  const s = 0.8 + rng() * 1.6;
  const c = 0.38 + rng() * 0.12;
  addBox(g, x, y + 0.3 * s, z, 1.4 * s, 1.0 * s, 1.1 * s, [c, c, c * 0.98], rng() * 6.28);
  addBox(g, x + 0.5 * s, y + 0.15 * s, z + 0.3 * s, 0.9 * s, 0.6 * s, 0.8 * s, [c * 0.9, c * 0.9, c * 0.88], rng() * 6.28);
  WORLD.colliders.push({ x: x, z: z, r: 0.9 * s });
}

function addHut(g, x, z, yaw, rng) {
  const y = terrainH(x, z);
  const w = 4.2 + rng() * 0.8, d = 3.4 + rng() * 0.6, h = 2.5;
  addBox(g, x, y + h / 2, z, w, h, d, COL_WOOD, yaw);
  addPyramid(g, x, y + h, z, w + 0.9, d + 0.9, 1.9, COL_ROOF, yaw);
  // door on the front (+Z local)
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  addBox(g, x + fx * (d / 2 + 0.04), y + 0.95, z + fz * (d / 2 + 0.04), 0.95, 1.8, 0.1, [0.15, 0.10, 0.07], yaw);
  WORLD.colliders.push({ x: x, z: z, r: Math.max(w, d) / 2 + 0.3 });
}

function addCampfire(g, x, z) {
  const y = terrainH(x, z);
  for (let i = 0; i < 7; i++) {
    const t = i / 7 * Math.PI * 2;
    addBox(g, x + Math.cos(t) * 0.85, y + 0.12, z + Math.sin(t) * 0.85, 0.4, 0.3, 0.35, [0.35, 0.34, 0.33], t);
  }
  addBox(g, x, y + 0.18, z, 1.1, 0.18, 0.22, COL_WOOD_DK, 0.5);
  addBox(g, x, y + 0.18, z, 1.1, 0.18, 0.22, COL_WOOD_DK, 2.1);
  WORLD.fires.push({ x: x, y: y + 0.55, z: z });
  WORLD.colliders.push({ x: x, z: z, r: 0.9 });
}

function buildWorld() {
  const g = { v: [] };
  const rng = mulberry32(1337);

  // ---- terrain (flat-shaded low-poly grid) ----
  const N = 128, S = WORLD.size;
  const step = 2 * S / N;
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const x0 = -S + ix * step, z0 = -S + iz * step;
      const x1 = x0 + step, z1 = z0 + step;
      const a = [x0, terrainH(x0, z0), z0];
      const b = [x0, terrainH(x0, z1), z1];
      const c = [x1, terrainH(x1, z1), z1];
      const d = [x1, terrainH(x1, z0), z0];
      const c1 = terrainColor((x0 + x1) / 2 - step * 0.2, (z0 + z1) / 2 + step * 0.2,
                              (a[1] + b[1] + c[1]) / 3);
      const c2 = terrainColor((x0 + x1) / 2 + step * 0.2, (z0 + z1) / 2 - step * 0.2,
                              (a[1] + c[1] + d[1]) / 3);
      pushTri(g, a, b, c, c1);
      pushTri(g, a, c, d, c2);
    }
  }

  // ---- Old Camp palisade (gate opens south, toward +Z) ----
  const R = WORLD.campR;
  const STAKES = 200;
  for (let i = 0; i < STAKES; i++) {
    const th = i / STAKES * Math.PI * 2;
    let dGate = Math.abs(th);
    dGate = Math.min(dGate, Math.PI * 2 - dGate);
    if (dGate < 0.10) continue; // gate opening
    const x = R * Math.sin(th), z = R * Math.cos(th);
    const y = terrainH(x, z);
    const shade = 0.9 + hash2(i, 3) * 0.25;
    addCylinder(g, x, y - 0.6, z, 0.34, 3.8 + hash2(i, 7) * 0.6, 5,
                [COL_WOOD[0] * shade, COL_WOOD[1] * shade, COL_WOOD[2] * shade], 0.04);
  }
  // collision for the ring is handled analytically in pushOutOfColliders()
  // horizontal rail binding the stakes together
  const RAIL = 60;
  for (let i = 0; i < RAIL; i++) {
    const th0 = i / RAIL * Math.PI * 2;
    let dGate = Math.abs(th0 + Math.PI / RAIL);
    dGate = Math.min(dGate, Math.PI * 2 - dGate);
    if (dGate < 0.13) continue;
    const thM = th0 + Math.PI / RAIL;
    const segLen = 2 * R * Math.sin(Math.PI / RAIL) + 0.3;
    const x = R * Math.sin(thM), z = R * Math.cos(thM);
    addBox(g, x, terrainH(x, z) + 2.3, z, segLen, 0.28, 0.18, COL_WOOD_DK, thM);
  }
  // gate posts + crossbar
  for (const sgn of [-1, 1]) {
    const th = sgn * 0.10;
    const x = R * Math.sin(th), z = R * Math.cos(th);
    const y = terrainH(x, z);
    addCylinder(g, x, y - 0.6, z, 0.5, 5.4, 6, COL_WOOD_DK, 0.1);
    WORLD.colliders.push({ x: x, z: z, r: 0.65 });
  }
  addBox(g, 0, terrainH(0, R) + 4.6, R, 7.6, 0.5, 0.7, COL_WOOD_DK);
  addBox(g, 0, terrainH(0, R) + 5.3, R, 5.0, 0.8, 0.5, COL_WOOD);

  // ---- the castle keep of the ore barons ----
  const ky = terrainH(0, -10);
  addBox(g, 0, ky + 4.5, -10, 8, 9, 8, COL_STONE);
  addBox(g, 0, ky + 9.2, -10, 9, 0.7, 9, [0.36, 0.34, 0.33]);
  WORLD.colliders.push({ x: 0, z: -10, r: 6.3 });
  for (const sgn of [-1, 1]) {
    addCylinder(g, sgn * 5.2, ky - 0.5, -5.2, 1.7, 12, 8, COL_STONE);
    addCylinder(g, sgn * 5.2, ky + 11.5, -5.2, 2.0, 0.5, 8, [0.36, 0.34, 0.33]);
    addCylinder(g, sgn * 5.2, ky + 12.0, -5.2, 1.9, 2.6, 8, COL_ROOF, 0);
    WORLD.colliders.push({ x: sgn * 5.2, z: -5.2, r: 2.0 });
  }

  // ---- huts of the diggers ----
  for (let i = 0; i < 8; i++) {
    const th = 0.78 + i * (Math.PI * 2 - 1.56) / 7;
    const rr = 20 + (i % 2) * 5;
    const x = rr * Math.sin(th), z = rr * Math.cos(th);
    addHut(g, x, z, th + Math.PI, rng);
  }

  // ---- campfires (these also become point lights) ----
  addCampfire(g, 9, 11);
  addCampfire(g, -13, -2);
  addCampfire(g, 14, -14);

  // ---- old mine entrance, north face of the valley ----
  const my = terrainH(0, -118);
  addBox(g, 0, my + 2.2, -124, 5.5, 5.5, 8, [0.10, 0.09, 0.09]);
  addCylinder(g, -2.4, my - 0.4, -119, 0.4, 4.6, 5, COL_WOOD_DK);
  addCylinder(g, 2.4, my - 0.4, -119, 0.4, 4.6, 5, COL_WOOD_DK);
  addBox(g, 0, my + 4.3, -119, 6.0, 0.7, 0.8, COL_WOOD_DK);
  WORLD.fires.push({ x: 3.4, y: my + 1.6, z: -117.5 });
  WORLD.colliders.push({ x: -2.4, z: -119, r: 0.55 });
  WORLD.colliders.push({ x: 2.4, z: -119, r: 0.55 });
  WORLD.colliders.push({ x: 0, z: -124, r: 4.5 });

  // ---- ruined watchtower (bandit hideout, north-east) ----
  const ruinSpots = [[58, -70, 4.5, 2.8], [62, -73, 3.0, 4.0], [55, -74, 2.2, 2.2]];
  for (const rs of ruinSpots) {
    const ry = terrainH(rs[0], rs[1]);
    addBox(g, rs[0], ry + rs[3] / 2, rs[1], rs[2], rs[3], 0.9, [0.40, 0.38, 0.35], rng() * 3);
    WORLD.colliders.push({ x: rs[0], z: rs[1], r: rs[2] / 2 + 0.2 });
  }

  // ---- gather nodes (dynamic meshes drawn per frame so they can vanish) ----
  function nodeMesh(builder) {
    const gn = { v: [] };
    builder(gn);
    return new Mesh(gn.v);
  }
  WORLD.nodeMeshes.tree = nodeMesh(function(gn) {
    addCylinder(gn, 0, -0.4, 0, 0.30, 4.8, 5, [0.32, 0.23, 0.14]);
    addBox(gn, 0.65, 3.0, 0.15, 1.7, 0.14, 0.14, [0.27, 0.19, 0.12], 0.5);
    addBox(gn, -0.55, 3.7, -0.2, 1.4, 0.12, 0.12, [0.29, 0.21, 0.13], 2.3);
    addBox(gn, 0.2, 2.2, -0.5, 1.2, 0.12, 0.12, [0.27, 0.19, 0.12], 4.1);
  });
  WORLD.nodeMeshes.stone = nodeMesh(function(gn) {
    addBox(gn, 0, 0.55, 0, 1.6, 1.2, 1.3, [0.56, 0.54, 0.51], 0.5);
    addBox(gn, 0.55, 0.32, 0.4, 1.0, 0.7, 0.9, [0.62, 0.60, 0.56], 1.4);
    addBox(gn, -0.5, 0.27, -0.35, 0.8, 0.6, 0.7, [0.51, 0.49, 0.47], 2.6);
  });
  WORLD.nodeMeshes.ore = nodeMesh(function(gn) {
    addBox(gn, 0, 0.5, 0, 1.8, 1.1, 1.5, [0.20, 0.17, 0.18], 0.7);
    // magic ore burns from within — bright even at night
    addBox(gn, 0.2, 1.15, 0.1, 0.36, 0.95, 0.36, [1.0, 0.28, 0.14], 0.4);
    addBox(gn, -0.42, 0.95, -0.2, 0.28, 0.72, 0.28, [0.95, 0.32, 0.10], 1.5);
    addBox(gn, 0.5, 0.85, -0.42, 0.22, 0.55, 0.22, [1.0, 0.42, 0.16], 2.3);
  });
  function addNode(kind, x, z, respawn, hits) {
    WORLD.nodes.push({ kind: kind, x: x, z: z, y: terrainH(x, z),
                       yaw: hash2(Math.round(x), Math.round(z)) * 6.28,
                       r: kind === 'tree' ? 0.5 : 0.9, hits: hits, maxHits: hits,
                       alive: true, respawnT: 0, respawn: respawn, shakeT: 0 });
  }
  for (const s of [[46, 64], [56, 50], [40, 84], [-46, 70], [-40, 90]]) addNode('tree', s[0], s[1], 90, 3);
  for (const s of [[24, 60], [-28, 52], [60, 36]]) addNode('stone', s[0], s[1], 75, 3);
  addNode('ore', -46, -86, 150, 4); // the one ore vein — wolf country

  // ---- forest ----
  let placed = 0;
  for (let tries = 0; tries < 900 && placed < 170; tries++) {
    const x = (rng() * 2 - 1) * 142;
    const z = (rng() * 2 - 1) * 142;
    const r = Math.hypot(x, z);
    if (r < 44 || r > 138) continue;
    if (distToPath(x, z) < 5.5) continue;
    if (Math.hypot(x + 70, z - 60) < 23) continue;      // lake
    if (Math.hypot(x - 58, z + 71) < 13) continue;      // ruin
    if (Math.hypot(x - 26, z - 98) < 10) continue;      // molerat ground
    if (Math.hypot(x, z + 120) < 14) continue;          // mine
    if (WORLD.nodes.some(function(nd) { return Math.hypot(x - nd.x, z - nd.z) < 4; })) continue;
    if (terrainH(x, z) < WORLD.waterLevel + 0.5) continue;
    if (terrainNormalY(x, z) < 0.75) continue;
    addTree(g, x, z, rng);
    placed++;
  }

  // ---- rocks ----
  for (let i = 0; i < 55; i++) {
    const x = (rng() * 2 - 1) * 145;
    const z = (rng() * 2 - 1) * 145;
    const r = Math.hypot(x, z);
    if (r < 40) continue;
    if (distToPath(x, z) < 4) continue;
    if (WORLD.nodes.some(function(nd) { return Math.hypot(x - nd.x, z - nd.z) < 4; })) continue;
    if (terrainH(x, z) < WORLD.waterLevel + 0.4) continue;
    addRock(g, x, z, rng);
  }

  WORLD.mesh = new Mesh(g.v);

  // ---- the lake surface ----
  const gw = { v: [] };
  const wl = WORLD.waterLevel;
  pushQuad(gw, [-112, wl, 18], [-112, wl, 102], [-26, wl, 102], [-26, wl, 18], [1, 1, 1]);
  WORLD.waterMesh = new Mesh(gw.v);
}
