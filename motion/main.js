import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

const W = 1920, H = 1080;
const TL = await (await fetch('timeline.json')).json();
const SC = Object.fromEntries(TL.scenes.map(s => [s.id, s]));
const DURATION = TL.duration;

// ───────────────────────── math helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const E = {
  lin: t => t,
  io: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  oe: t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),
  oc: t => 1 - Math.pow(1 - t, 3),
  ic: t => t * t * t,
  ob: t => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// time reference resolver: "s4" scene start, "s4.e" scene end, "s4.2" cue 2 start, "+/-n" offset
function R(ref) {
  if (typeof ref === 'number') return ref;
  const m = /^([a-z0-9]+)(?:\.(\w+))?\s*([+-]\s*[\d.]+)?$/.exec(ref.trim());
  if (!m || !SC[m[1]]) throw new Error('bad time ref ' + ref);
  const sc = SC[m[1]];
  let t = m[2] === undefined ? sc.start : m[2] === 'e' ? sc.end : sc.cues[+m[2]].t;
  return t + (m[3] ? parseFloat(m[3].replace(/\s/g, '')) : 0);
}
function track(keys) { return keys.map(k => [R(k[0]), k[1], E[k[2] || 'io']]); }
function sample(tr, t) {
  if (t <= tr[0][0]) return tr[0][1];
  for (let i = 0; i < tr.length - 1; i++) {
    const [t0, v0] = tr[i], [t1, v1, e] = tr[i + 1];
    if (t <= t1) {
      const p = t1 === t0 ? 1 : e((t - t0) / (t1 - t0));
      return Array.isArray(v0) ? v0.map((a, j) => lerp(a, v1[j], p)) : lerp(v0, v1, p);
    }
  }
  return tr[tr.length - 1][1];
}
const gauss = (t, c, s) => Math.exp(-(((t - c) / s) ** 2));
const TRANSITIONS = TL.scenes.slice(1).map(s => s.start);
const pulse = (t, s = .3) => TRANSITIONS.reduce((a, c) => a + gauss(t, c, s), 0);

// ───────────────────────── renderer / scene
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f4f1fb');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 1.0;

const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 200);
camera.position.set(0, 0, 10);
scene.add(camera);

const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(1);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.25, 0.5, 0.985);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const rgbShift = new ShaderPass(RGBShiftShader);
composer.addPass(rgbShift);

// lights
const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(4, 6, 8); scene.add(key);
const rimBlue = new THREE.PointLight('#ff9ad5', 60, 0, 2); rimBlue.position.set(-6, 3, -3); scene.add(rimBlue);
const rimCyan = new THREE.PointLight('#6fe8cf', 50, 0, 2); rimCyan.position.set(6, -2, -2); scene.add(rimCyan);
const amberL = new THREE.PointLight('#ff7a6b', 0, 0, 2); amberL.position.set(-2, 2, 5); scene.add(amberL);

// ───────────────────────── 2D drawing of the logos (canvas + svg)
const LOGO = {
  // image-space (400×400) geometry traced from the provided logos
  yen: [[121, 117], [177, 117], [201, 160], [225, 117], [281, 117], [226, 199], [273, 199], [273, 219], [226, 219], [226, 231], [273, 231], [273, 251], [226, 251], [226, 298], [176, 298], [176, 251], [127, 251], [127, 231], [176, 231], [176, 219], [127, 219], [127, 199], [176, 199]],
  ringIn: 145, ringOut: 168, gap: 0.075,
  squares: [[-62.5, -62.5], [62.5, -62.5], [-62.5, 62.5], [62.5, 62.5]].map(([x, y]) => [200 + x, 200 + y]), sq: 55,
  diamonds: [[0, -91.5], [0, 91.5], [-91.5, 0], [91.5, 0]].map(([x, y]) => [200 + x, 200 + y]), dia: 36.5,
};
function drawJPYSC(g, cx, cy, size) {
  const s = size / 400; g.save(); g.translate(cx - size / 2, cy - size / 2); g.scale(s, s);
  g.fillStyle = '#0b4ea2'; g.beginPath(); g.arc(200, 200, 200, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff';
  for (let k = 0; k < 4; k++) {
    const a0 = k * Math.PI / 2 + LOGO.gap, a1 = (k + 1) * Math.PI / 2 - LOGO.gap;
    g.beginPath(); g.arc(200, 200, LOGO.ringOut, a0, a1); g.arc(200, 200, LOGO.ringIn, a1, a0, true); g.closePath(); g.fill();
  }
  g.beginPath(); LOGO.yen.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
  g.restore();
}
function drawStartale(g, cx, cy, size, bg = '#000') {
  const s = size / 400; g.save(); g.translate(cx - size / 2, cy - size / 2); g.scale(s, s);
  if (bg) { g.fillStyle = bg; g.beginPath(); g.arc(200, 200, 200, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#fff';
  LOGO.squares.forEach(([x, y]) => g.fillRect(x - LOGO.sq / 2, y - LOGO.sq / 2, LOGO.sq, LOGO.sq));
  LOGO.diamonds.forEach(([x, y]) => { const d = LOGO.dia; g.beginPath(); g.moveTo(x, y - d); g.lineTo(x + d, y); g.lineTo(x, y + d); g.lineTo(x - d, y); g.closePath(); g.fill(); });
  g.restore();
}
{ // HUD svg logo
  const d = [];
  LOGO.squares.forEach(([x, y]) => { const h = LOGO.sq / 2; d.push(`M${x - h} ${y - h}h${LOGO.sq}v${LOGO.sq}h${-LOGO.sq}z`); });
  LOGO.diamonds.forEach(([x, y]) => { const r = LOGO.dia; d.push(`M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}z`); });
  document.getElementById('hudLogo').innerHTML = `<circle cx="200" cy="200" r="196" fill="#000" stroke="rgba(160,205,255,.6)" stroke-width="10"/><path fill="#fff" d="${d.join('')}"/>`;
}

// ───────────────────────── 3D logo construction
const S = 1 / 200;
const P = (x, y) => new THREE.Vector2((x - 200) * S, -(y - 200) * S);
function polyShape(pts) { const s = new THREE.Shape(); pts.forEach((p, i) => { const v = P(p[0], p[1]); i ? s.lineTo(v.x, v.y) : s.moveTo(v.x, v.y); }); s.closePath(); return s; }
function ringArc(ri, ro, a0, a1) { const s = new THREE.Shape(); s.absarc(0, 0, ro, a0, a1, false); s.absarc(0, 0, ri, a1, a0, true); s.closePath(); return s; }

const DISC = { depth: .14, bevelThickness: .055, bevelSize: .05, bevelSegments: 8, curveSegments: 128, bevelEnabled: true };
function discGeo() {
  const sh = new THREE.Shape(); sh.absarc(0, 0, 1 - DISC.bevelSize, 0, Math.PI * 2, false);
  const g = new THREE.ExtrudeGeometry(sh, DISC); g.translate(0, 0, -DISC.depth / 2); return g;
}
const FACE_Z = DISC.depth / 2 + DISC.bevelThickness;
const SYM = { depth: .045, bevelEnabled: true, bevelThickness: .012, bevelSize: .009, bevelSegments: 3, curveSegments: 48 };
function symbolMeshes(shapes, mat) {
  const grp = new THREE.Group();
  const geo = new THREE.ExtrudeGeometry(shapes, SYM);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.z = side * (FACE_Z - .004);
    if (side < 0) m.rotation.y = Math.PI;
    grp.add(m);
  }
  return grp;
}
function edgeRing(color, r = 1.004) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, .012, 12, 160), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95, depthWrite: false }));
  return m;
}
function radialTex(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const haloTex = radialTex([[0, 'rgba(255,255,255,1)'], [.28, 'rgba(255,214,240,.7)'], [.5, 'rgba(196,236,255,.35)'], [.72, 'rgba(214,200,255,.12)'], [1, 'rgba(255,255,255,0)']]);
function halo(scale, opacity, color = '#ffffff') {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color, transparent: true, opacity, depthWrite: false }));
  s.scale.setScalar(scale); s.renderOrder = -1; return s;
}

// JPYSC coin
const jp = new THREE.Group();
{
  const blueMat = new THREE.MeshPhysicalMaterial({ color: '#0b4ea2', metalness: .3, roughness: .28, clearcoat: 1, clearcoatRoughness: .08, envMapIntensity: .9, iridescence: .55, iridescenceIOR: 1.5, iridescenceThicknessRange: [200, 700] });
  const whiteMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: .1, roughness: .22, clearcoat: 1, emissive: '#ffffff', emissiveIntensity: .06, envMapIntensity: .8 });
  jp.add(new THREE.Mesh(discGeo(), blueMat));
  const shapes = [polyShape(LOGO.yen)];
  for (let k = 0; k < 4; k++) shapes.push(ringArc(LOGO.ringIn * S, LOGO.ringOut * S, k * Math.PI / 2 + LOGO.gap, (k + 1) * Math.PI / 2 - LOGO.gap));
  jp.add(symbolMeshes(shapes, whiteMat));
  const er = edgeRing('#ffffff'); jp.add(er);
  jp.userData.halo = halo(4.4, .6, '#ffffff'); jp.add(jp.userData.halo);
  scene.add(jp);
}
// Startale logo
const st = new THREE.Group();
{
  const blackMat = new THREE.MeshPhysicalMaterial({ color: '#020203', metalness: .5, roughness: .22, clearcoat: .7, clearcoatRoughness: .12, envMapIntensity: .45 });
  const whiteMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: .05, roughness: .2, clearcoat: 1, emissive: '#ffffff', emissiveIntensity: .08 });
  st.add(new THREE.Mesh(discGeo(), blackMat));
  const shapes = [];
  LOGO.squares.forEach(([x, y]) => { const h = LOGO.sq / 2; shapes.push(polyShape([[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]])); });
  LOGO.diamonds.forEach(([x, y]) => { const d = LOGO.dia; shapes.push(polyShape([[x, y - d], [x + d, y], [x, y + d], [x - d, y]])); });
  st.add(symbolMeshes(shapes, whiteMat));
  st.add(edgeRing('#ffffff'));
  st.userData.halo = halo(4.4, .5, '#ffffff'); st.add(st.userData.halo);
  scene.add(st);
}

// Bond card
const card = new THREE.Group();
const CW = 3.4, CH = 2.1;
async function buildCard() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = Math.round(2048 * CH / CW); const g = c.getContext('2d');
  const w = c.width, h = c.height;
  g.beginPath(); g.roundRect(0, 0, w, h, 52); g.save(); g.clip();
  let gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.5, '#f4efff'); gr.addColorStop(1, '#e4f6ff');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (const [x, y, r, col] of [[1700, 200, 700, 'rgba(255,170,225,.45)'], [300, 1100, 800, 'rgba(150,235,215,.45)'], [1100, 650, 600, 'rgba(190,175,255,.35)']]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, h);
  }
  g.lineWidth = 2;
  for (let k = 0; k < 46; k++) {
    g.strokeStyle = `rgba(106,92,255,${.05 + .06 * Math.sin(k * .4) ** 2})`; g.beginPath();
    for (let x = 0; x <= w; x += 8) { const y = 600 + Math.sin(x * .0042 + k * .21) * (180 + k * 3) * Math.cos(x * .0011 + k * .05); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  g.save(); g.translate(1640, 420);
  for (let k = 0; k < 60; k++) { g.rotate(Math.PI / 60); g.strokeStyle = 'rgba(192,79,208,.08)'; g.beginPath(); g.ellipse(0, 0, 330, 120, 0, 0, Math.PI * 2); g.stroke(); }
  g.restore();
  const holo = (x0, x1) => { const q = g.createLinearGradient(x0, 0, x1, 0); q.addColorStop(0, '#6a5cff'); q.addColorStop(.5, '#c04fd0'); q.addColorStop(1, '#13a6c4'); return q; };
  drawStartale(g, 160, 150, 120);
  g.fillStyle = '#141838'; g.font = '800 38px "Inter Display"'; g.letterSpacing = '8px'; g.fillText('STARTALE GROUP', 250, 164);
  g.textAlign = 'right'; g.fillStyle = '#6a5cff'; g.font = '700 30px "Inter Display"'; g.letterSpacing = '10px'; g.fillText('DIGITAL CORPORATE BOND', w - 100, 162);
  g.textAlign = 'left'; g.letterSpacing = '-4px';
  g.fillStyle = '#141838'; g.font = '800 150px "Inter Display"'; g.fillText('STARTALE BOND', 100, 470);
  g.letterSpacing = '0px'; g.fillStyle = 'rgba(20,24,56,.62)'; g.font = '500 40px "Inter Display"'; g.fillText('Japan  ·  Guaranteed by Startale Group (parent)', 106, 548);
  g.textAlign = 'right'; g.letterSpacing = '-6px';
  g.fillStyle = holo(1450, 1950); g.font = '800 120px "Inter Display"'; g.fillText('5.00%', w - 100, 360);
  g.letterSpacing = '6px'; g.fillStyle = '#6a5cff'; g.font = '700 26px "Inter Display"'; g.fillText('ANNUAL · PRE-TAX', w - 100, 250);
  g.textAlign = 'left';
  g.fillStyle = holo(100, w - 100); g.fillRect(100, 640, w - 200, 4);
  [['TERM', '1 YEAR'], ['MINIMUM', '¥100,000'], ['ISSUANCE', '¥99.9M'], ['MATURITY', 'DEC 2027']].forEach(([l, v], i) => {
    const x = 100 + i * 470;
    g.letterSpacing = '6px'; g.fillStyle = '#6a5cff'; g.font = '700 26px "Inter Display"'; g.fillText(l, x, 730);
    g.letterSpacing = '-2px'; g.fillStyle = '#141838'; g.font = '800 66px "Inter Display"'; g.fillText(v, x, 812);
  });
  gr = g.createLinearGradient(0, 0, w, 0);
  ['#cbbcff', '#ffc2e6', '#bff3e3', '#bfe6ff', '#d9c8ff'].forEach((col, i, a) => gr.addColorStop(i / (a.length - 1), col));
  g.fillStyle = gr; g.fillRect(0, 930, w, h - 930);
  drawJPYSC(g, 175, 1076, 150);
  g.letterSpacing = '4px'; g.fillStyle = '#141838'; g.font = '800 46px "Inter Display"'; g.fillText('INTEREST & PRINCIPAL PAID IN JPYSC', 280, 1068);
  g.letterSpacing = '6px'; g.fillStyle = 'rgba(20,24,56,.65)'; g.font = '600 26px "Inter Display"'; g.fillText('YEN STABLECOIN  ·  ISSUED BY SBI SHINSEI TRUST BANK', 282, 1118);
  g.restore();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;

  const body = new THREE.Mesh(new RoundedBoxGeometry(CW, CH, .06, 4, .08), new THREE.MeshPhysicalMaterial({ color: '#f6f3ff', metalness: .2, roughness: .2, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 800] }));
  card.add(body);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(CW - .02, CH - .02), faceMat); face.position.z = .032; card.add(face);
  const back = face.clone(); back.material = new THREE.MeshPhysicalMaterial({ color: '#efe9ff', metalness: .3, roughness: .2, clearcoat: 1, iridescence: 1 }); back.rotation.y = Math.PI; back.position.z = -.032; card.add(back);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new RoundedBoxGeometry(CW + .01, CH + .01, .065, 4, .08), 30), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: .85 }));
  card.add(edge);
  card.userData.halo = halo(6, .3, '#ffffff'); card.add(card.userData.halo);
  scene.add(card);
}

// "5%" 3D text
const five = new THREE.Group();
const fiveMat = new THREE.MeshPhysicalMaterial({ color: '#e9e4ff', metalness: 1, roughness: .12, clearcoat: 1, clearcoatRoughness: .04, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [250, 950], envMapIntensity: 1.5 });
async function buildFive() {
  const font = await new FontLoader().loadAsync('node_modules/three/examples/fonts/helvetiker_bold.typeface.json');
  const geo = new TextGeometry('5%', { font, size: 1.45, depth: .38, height: .38, curveSegments: 16, bevelEnabled: true, bevelThickness: .05, bevelSize: .035, bevelSegments: 5 });
  geo.computeBoundingBox(); const b = geo.boundingBox; geo.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);
  five.add(new THREE.Mesh(geo, fiveMat));
  five.userData.halo = halo(5, .5, '#ffffff'); five.add(five.userData.halo);
  scene.add(five);
}

// small instanced coins (face texture drawn from the logo)
const coinFaceTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); drawJPYSC(g, 256, 256, 512); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.center.set(.5, .5); t.rotation = Math.PI / 2; return t; })();
const COINS = 48;
const coinGeo = new THREE.CylinderGeometry(.2, .2, .035, 48); coinGeo.rotateX(Math.PI / 2);
const coinMats = [
  new THREE.MeshPhysicalMaterial({ color: '#2a6fd0', metalness: .6, roughness: .25, iridescence: .6 }),
  new THREE.MeshPhysicalMaterial({ map: coinFaceTex, emissiveMap: coinFaceTex, emissive: '#ffffff', emissiveIntensity: .15, metalness: .2, roughness: .3, clearcoat: 1 }),
  new THREE.MeshPhysicalMaterial({ map: coinFaceTex, emissiveMap: coinFaceTex, emissive: '#ffffff', emissiveIntensity: .15, metalness: .2, roughness: .3, clearcoat: 1 }),
];
const coins = new THREE.InstancedMesh(coinGeo, coinMats, COINS); coins.frustumCulled = false; scene.add(coins);

// soft dots shader (used by flows, particles)
const dotVS = `
  attribute float aSize; attribute float aAlpha; uniform float uPix; varying float vA;
  void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = aSize*uPix/-mv.z; vA = aAlpha; }`;
const dotFS = `
  uniform vec3 uColor; uniform float uOpacity; varying float vA;
  void main(){ vec2 c = gl_PointCoord-.5; float d = length(c); float a = smoothstep(.5,.0,d); a = a*a*1.4 + smoothstep(.12,.0,d);
    gl_FragColor = vec4(mix(vec3(1.),uColor,smoothstep(.0,.3,d)), clamp(a,0.,1.)*uOpacity*vA); }`;

class Flow {
  constructor(pts, { color = '#2f7dff', radius = .02, dots = 10, dotSize = 26, glow = 4 } = {}) {
    this.curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'centripetal');
    this.seg = 240; this.rad = 10;
    const mk = (r, op) => new THREE.Mesh(new THREE.TubeGeometry(this.curve, this.seg, r, this.rad, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
    this.core = mk(radius, 1); this.glow = mk(radius * glow, .22);
    this.n = dots;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dots * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(dots).fill(dotSize / 110), 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(dots).fill(1), 1));
    this.dots = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: dotVS, fragmentShader: dotFS, transparent: true, depthWrite: false,
      uniforms: { uPix: { value: H / 2 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } } }));
    this.dots.frustumCulled = false;
    this.group = new THREE.Group(); this.group.add(this.core, this.glow, this.dots); scene.add(this.group);
    this.baseOp = [1, .22];
  }
  update(t, { op = 1, draw = 1, speed = .2, dir = 1 } = {}) {
    this.group.visible = op > .002;
    if (!this.group.visible) return;
    const cnt = Math.floor(clamp(draw) * this.seg) * this.rad * 6;
    this.core.geometry.setDrawRange(0, cnt); this.glow.geometry.setDrawRange(0, cnt);
    this.core.material.opacity = op * this.baseOp[0]; this.glow.material.opacity = op * this.baseOp[1];
    this.dots.material.uniforms.uOpacity.value = op;
    const pos = this.dots.geometry.attributes.position, al = this.dots.geometry.attributes.aAlpha, v = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      let u = ((t * speed + i / this.n) % 1 + 1) % 1; if (dir < 0) u = 1 - u;
      this.curve.getPointAt(u, v); pos.setXYZ(i, v.x, v.y, v.z);
      al.setX(i, u < draw ? Math.sin(Math.PI * u) ** .5 : 0);
    }
    pos.needsUpdate = true; al.needsUpdate = true;
  }
}
// scene 5 lanes
const ISSUER = [-4.5, -0.35, 0], HOLDERS = [4.5, -0.35, 0];
const laneBank = new Flow([ISSUER, [-2.6, 0.7, 0], [0, 1.0, 0], [2.6, 0.7, 0], HOLDERS], { color: '#9aa0b8', radius: .012, dots: 7, dotSize: 22, glow: 3 });
const laneChain = new Flow([ISSUER, [-2.4, -1.3, 0.25], [0, -1.45, 0.35], [2.4, -1.3, 0.25], HOLDERS], { color: '#6a5cff', radius: .026, dots: 18, dotSize: 30 });
// scene 7 beams
const beamL = new Flow([[-3.05, 0.4, 0], [-1.9, 0.62, 0.15], [-0.9, 0.42, 0]], { color: '#8b6cff', radius: .02, dots: 8, dotSize: 28 });
const beamR = new Flow([[3.05, 0.4, 0], [1.9, 0.62, 0.15], [0.9, 0.42, 0]], { color: '#c04fd0', radius: .02, dots: 8, dotSize: 28 });
// scene 9 bridge
const bridge = new Flow([[-2.85, -0.55, 0], [-1.4, -0.42, 0], [0, -0.55, 0], [1.4, -0.42, 0], [2.95, -0.55, 0]], { color: '#6a5cff', radius: .032, dots: 22, dotSize: 30, glow: 4 });

// ring nodes (holders S5 / SBI S7)
function ringNode(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
  const r1 = new THREE.Mesh(new THREE.TorusGeometry(.62, .014, 12, 128), mat);
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(.78, .006, 8, 128), mat.clone()); r2.material.opacity = .5;
  g.add(r1, r2);
  const h = halo(3.2, .55, '#ffffff'); g.add(h);
  g.userData = { r1, r2, mat };
  scene.add(g); return g;
}
const holders = ringNode('#7b6cff');
const holderDots = new THREE.InstancedMesh(new THREE.SphereGeometry(.07, 16, 12), new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#b9a8ff', emissiveIntensity: .35, metalness: .2, roughness: .2, iridescence: 1 }), 7);
holders.add(holderDots);
const sbiRing = ringNode('#c04fd0');

// orbit (S6)
const orbit = new THREE.Group(); scene.add(orbit);
const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(1.62, .008, 8, 200), new THREE.MeshBasicMaterial({ color: '#8b7cff', transparent: true, opacity: .7, depthWrite: false }));
orbit.add(orbitRing);
const sats = [0, 1, 2, 3].map(i => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(.09, 24, 16), new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#d8ccff', emissiveIntensity: .3, roughness: .1, iridescence: 1, iridescenceIOR: 1.7 }));
  m.add(halo(1.3, .9, '#ffffff')); orbit.add(m); return m;
});

// iridescent soap bubbles (theme)
const bubbleVS = `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;
const bubbleFS = `uniform float uTime,uOp,uSeed; varying vec3 vN; varying vec3 vV;
  vec3 hue(float h){ return .5+.5*cos(6.28318*(h+vec3(0.,.33,.67))); }
  void main(){ vec3 n=normalize(vN); float f=1.-max(dot(n,vV),0.); float fr=pow(f,2.);
    vec3 ir=mix(vec3(1.),hue(f*1.4+n.y*.45+n.x*.2+uTime*.04+uSeed),.62);
    vec3 R=reflect(-vV,n);
    float sp=pow(max(dot(R,normalize(vec3(-.45,.6,.65))),0.),70.)*1.4+pow(max(dot(R,normalize(vec3(.5,-.45,.7))),0.),18.)*.3;
    float a=.05+fr*.85+sp; vec3 col=mix(ir,vec3(1.),clamp(sp,0.,1.));
    gl_FragColor=vec4(col,clamp(a,0.,1.)*uOp); }`;
const bubbleGeo = new THREE.SphereGeometry(1, 48, 32);
const bubbles = [];
{
  const r = rng(21);
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(bubbleGeo, new THREE.ShaderMaterial({ vertexShader: bubbleVS, fragmentShader: bubbleFS, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uOp: { value: 1 }, uSeed: { value: r() } } }));
    m.userData = i === 0 ? { hero: true } : { x: (r() - .5) * 2, y: r(), z: -16 + r() * 13, s: .3 + r() * .8, sp: r(), ph: r() * 6.28 };
    m.renderOrder = 5; scene.add(m); bubbles.push(m);
  }
}
function updateBubbles(t) {
  for (const b of bubbles) {
    const u = b.userData; b.material.uniforms.uTime.value = t;
    if (u.hero) { b.position.set(6.05 + Math.sin(t * .5) * .08, -2.75 + Math.sin(t * .7) * .1, .5); b.scale.setScalar(.95); continue; }
    const d = 10 - u.z, hh = d * .3153, hw = hh * 1.778;
    const yy = (u.y + t * .012 * (1 + u.sp * 1.5)) % 1;
    b.position.set(u.x * hw * 1.05 + Math.sin(t * .4 + u.ph) * .35, -hh * 1.3 + yy * hh * 2.6, u.z);
    b.scale.setScalar(u.s * d / 11);
  }
}

// background gradient plane (child of camera)
const bgMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uWarm: { value: 0 }, uBoost: { value: 0 } }, depthWrite: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform float uTime,uWarm,uBoost; varying vec2 vUv;
    vec3 blob(vec3 col, vec3 c, vec2 p, vec2 at, float k, float w){ vec2 d=p-at; return mix(col, c, w*exp(-dot(d,d)*k)); }
    void main(){ vec2 p=vUv-.5; p.x*=1.78; float T=uTime;
      vec3 col=vec3(.93,.915,.975);
      vec3 pink=mix(vec3(.94,.62,.84),vec3(1.,.66,.6),uWarm), mint=mix(vec3(.62,.93,.8),vec3(1.,.8,.62),uWarm*.7);
      vec3 aqua=vec3(.66,.9,.95), lav=mix(vec3(.8,.72,.97),vec3(.98,.72,.8),uWarm), sky=vec3(.74,.85,.99);
      col=blob(col,sky,p,vec2(-.55+.08*sin(T*.05),.05+.1*cos(T*.06)),3.,.75);
      col=blob(col,pink,p,vec2(.1+.25*sin(T*.04),.3+.05*cos(T*.07)),4.,.8);
      col=blob(col,mint,p,vec2(.75+.06*cos(T*.05),.25*sin(T*.045)),3.2,.85);
      col=blob(col,lav,p,vec2(-.7+.1*cos(T*.03),-.32),4.5,.8);
      col=blob(col,aqua,p,vec2(.55,-.38+.06*sin(T*.06)),4.,.7);
      col=blob(col,pink,p,vec2(-.2+.2*cos(T*.035),-.45),6.,.55);
      col=blob(col,vec3(1.),p,vec2(.0,.0),2.5,.45+uBoost*.4);
      gl_FragColor=vec4(col,1.); }`,
});
const bg = new THREE.Mesh(new THREE.PlaneGeometry(90, 52), bgMat); bg.position.z = -60; camera.add(bg); bg.renderOrder = -10;

// grid floor
const gridMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, extensions: { derivatives: true },
  uniforms: { uScroll: { value: 0 }, uOp: { value: 1 }, uColor: { value: new THREE.Color('#2f7dff') }, uTime: { value: 0 } },
  vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float uScroll,uOp,uTime; uniform vec3 uColor; varying vec3 vW;
    float grid(vec2 p,float s,float w){ vec2 q=p/s; vec2 g=abs(fract(q-.5)-.5)/(fwidth(q)*w); return 1.-min(min(g.x,g.y),1.); }
    void main(){ vec2 p=vW.xz; p.y+=uScroll;
      float g=grid(p,1.,1.)*.28+grid(p,4.,1.6)*.7;
      float d=length(vW.xz-vec2(0.,4.));
      float fade=smoothstep(42.,6.,d)*smoothstep(0.,6.,d);
      float sweep=smoothstep(1.2,0.,abs(fract(p.y*.04-uTime*.12)-.5)*25.);
      gl_FragColor=vec4(uColor,clamp(g*(.7+sweep*1.2)*fade*uOp*.55,0.,1.)); }`,
});
const grid = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), gridMat); grid.rotation.x = -Math.PI / 2; grid.position.y = -2.7; scene.add(grid);

// particles
const PN = 2600;
const partMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 }, uWarp: { value: 0 }, uPix: { value: H / 2 }, uA: { value: new THREE.Color('#4d94ff') }, uB: { value: new THREE.Color('#ff9ad5') }, uOp: { value: 1 } },
  vertexShader: `attribute vec3 aVel; attribute float aSeed; uniform float uTime,uWarp,uPix; varying float vA; varying float vS;
    void main(){ vec3 box=vec3(44.,26.,70.); vec3 p=position+aVel*uTime; p.z+=uWarp;
      p=mod(p+box*.5,box)-box*.5; p.z-=18.;
      vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
      float tw=.55+.45*sin(uTime*(1.+aSeed*3.)+aSeed*40.);
      gl_PointSize=uPix*(.035+aSeed*.06)/-mv.z*(1.+min(uWarp*0.,0.));
      vA=tw*smoothstep(70.,10.,-mv.z)*smoothstep(.5,4.,-mv.z); vS=aSeed; }`,
  fragmentShader: `uniform vec3 uA,uB; uniform float uOp; varying float vA; varying float vS;
    void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,0.,d); a*=a; vec3 c=mix(uA,uB,step(.72,vS)); gl_FragColor=vec4(mix(vec3(1.),c,.8),a*vA*uOp*.75); }`,
});
{
  const r = rng(7), pos = new Float32Array(PN * 3), vel = new Float32Array(PN * 3), seed = new Float32Array(PN);
  for (let i = 0; i < PN; i++) {
    pos.set([(r() - .5) * 44, (r() - .5) * 26, (r() - .5) * 70], i * 3);
    vel.set([(r() - .5) * .12, (r() - .3) * .1, .2 + r() * .3], i * 3); seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const pts = new THREE.Points(g, partMat); pts.frustumCulled = false; scene.add(pts);
}
// warp streaks
const STREAKS = 320;
const streakMat = new THREE.MeshBasicMaterial({ color: '#a99bff', transparent: true, opacity: 0, depthWrite: false });
const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(.018, .018, 1), streakMat, STREAKS); streaks.frustumCulled = false; scene.add(streaks);
const streakSeed = (() => { const r = rng(42); return Array.from({ length: STREAKS }, () => { const a = r() * Math.PI * 2, rad = 2.5 + r() * 14; return [Math.cos(a) * rad, Math.sin(a) * rad * .7, r() * 90]; }); })();

// ───────────────────────── tracks
const PI2 = Math.PI * 2;
const T = {
  st: {
    pos: track([['s1', [-11, 3, -26]], ['s1+0.4', [-11, 3, -26]], ['s1+2.8', [-2.15, 0.85, 0], 'oe'], ['s1.e-0.45', [-2.15, 0.85, 0]], ['s1.e+0.15', [-10, 1, -6], 'ic'],
      ['s4.6-0.6', [-9, -1.8, -3]], ['s4.6+0.5', [-4.45, -1.75, 0], 'oe'], ['s4.e-0.35', [-4.45, -1.75, 0]], ['s5+0.45', ISSUER, 'io'], ['s5.e-0.4', ISSUER], ['s5.e+0.2', [-10, -0.35, -3], 'ic'],
      ['s7.1-0.7', [-10, 0.4, -3]], ['s7.1+0.4', [-3.75, 0.4, 0], 'oe'], ['s7.e-0.45', [-3.75, 0.4, 0]], ['s7.e+0.12', [-10, 0.4, -3], 'ic'],
      ['s9.1-0.4', [0, 4.5, 0]], ['s9.1+0.6', [0, -0.55, 0.4], 'oe'], ['end-0.2', [0, -0.55, 0.4]], ['end+0.9', [-1.45, 0.55, 0], 'io']]),
    scale: track([['s1', 1.05], ['s1.e+0.15', 1.05], ['s1.e+0.16', 0], ['s4.6-0.61', 0], ['s4.6-0.6', .42], ['s4.e-0.35', .42], ['s5+0.45', .62], ['s5.e+0.2', .62], ['s5.e+0.21', 0],
      ['s7.1-0.71', 0], ['s7.1-0.7', .6], ['s7.e+0.12', .6], ['s7.e+0.13', 0], ['s9.1-0.41', 0], ['s9.1-0.4', .48], ['end-0.2', .48], ['end+0.9', .92]]),
    rot: track([['s1+0.4', [0.6, -4 * PI2, 0.3]], ['s1+2.8', [0, 0.28, 0], 'oe'], ['s1.e-0.45', [0, 0.28, 0]], ['s1.e+0.15', [0, -1.2, 0]],
      ['s4.6-0.6', [0, 3.5, 0]], ['s4.6+0.5', [0, 0.25, 0], 'oe'], ['s5.e', [0, 0.3, 0]], ['s7.1-0.7', [0, -3.5, 0]], ['s7.1+0.4', [0, 0.3, 0], 'oe'], ['s7.e', [0, 0.3, 0]],
      ['s9.1-0.4', [0, PI2 * 2, 0]], ['s9.1+0.6', [0, 0, 0], 'oe'], ['end-0.2', [0, 0, 0]], ['end+0.9', [0, 0.22, 0]]]),
    phase: 0,
  },
  jp: {
    pos: track([['s1', [11, -3, -26]], ['s1+0.7', [11, -3, -26]], ['s1+3.1', [2.15, 0.85, 0], 'oe'], ['s1.e-0.45', [2.15, 0.85, 0]], ['s1.e+0.15', [10, 1, -6], 'ic'],
      ['s2.1-0.6', [9, -3, 3]], ['s2.1+0.5', [4.2, -1.05, 0.75], 'oe'], ['s2.e-0.4', [4.2, -1.05, 0.75]], ['s3+0.4', [0, 0, -1.2], 'io'], ['s3.e-0.35', [0, 0.05, -0.6]], ['s3.e+0.22', [0, 0, 10.4], 'ic'],
      ['s6-0.5', [9, 0, -5]], ['s6+0.7', [2.85, -0.1, 0], 'oe'], ['s6.e-0.45', [2.85, -0.1, 0]], ['s7+0.55', [0, 0.4, 0], 'io'], ['s7.e-0.45', [0, 0.4, 0]], ['s7.e+0.15', [0, -6, 0], 'ic'],
      ['s9.1-0.6', [10, -0.55, 0]], ['s9.1+0.35', [3.7, -0.55, 0], 'oe'], ['end-0.2', [3.7, -0.55, 0]], ['end+0.9', [1.45, 0.55, 0], 'io']]),
    scale: track([['s1', 1.05], ['s1.e+0.15', 1.05], ['s1.e+0.16', 0], ['s2.1-0.61', 0], ['s2.1-0.6', .45], ['s2.e-0.4', .45], ['s3+0.4', 1.1], ['s3.e-0.35', 1.18], ['s3.e+0.22', 1.4], ['s3.e+0.23', 0],
      ['s6-0.51', 0], ['s6-0.5', .78], ['s6.e-0.45', .78], ['s7+0.55', .85], ['s7.e+0.15', .85], ['s7.e+0.16', 0], ['s9.1-0.61', 0], ['s9.1-0.6', .62], ['end-0.2', .62], ['end+0.9', .92]]),
    rot: track([['s1+0.7', [-0.6, 4 * PI2, -0.3]], ['s1+3.1', [0, -0.28, 0], 'oe'], ['s1.e-0.45', [0, -0.28, 0]], ['s1.e+0.15', [0, 1.2, 0]],
      ['s2.1-0.6', [0, -3 * PI2, 0]], ['s2.1+0.5', [0, -0.35, 0], 'oe'], ['s2.e-0.4', [0, -0.35, 0]], ['s3+0.4', [0.1, 0.5, 0]], ['s3.e-0.35', [-0.05, -0.5, 0], 'lin'], ['s3.e+0.22', [0, -0.3, 0]],
      ['s6-0.5', [0, -PI2 * 2, 0]], ['s6+0.7', [0, -0.35, 0], 'oe'], ['s6.e-0.45', [0, -0.35, 0]], ['s7+0.55', [0, PI2, 0]], ['s7.e', [0, PI2, 0]],
      ['s9.1-0.6', [0, -3 * PI2, 0]], ['s9.1+0.35', [0, -0.2, 0], 'oe'], ['end-0.2', [0, -0.2, 0]], ['end+0.9', [0, -0.22, 0]]]),
    phase: 1.7,
  },
  card: {
    pos: track([['s2', [3, -7, -2]], ['s2+1.3', [2.75, 0.15, 0], 'oe'], ['s2.e-0.4', [2.75, 0.15, 0]], ['s2.e+0.2', [7, 4, -5], 'ic'],
      ['s9.1-0.6', [-10, -0.55, 0]], ['s9.1+0.35', [-3.7, -0.55, 0], 'oe'], ['end-0.2', [-3.7, -0.55, 0]], ['end+0.5', [-7, -3, -2], 'ic']]),
    scale: track([['s2', 1], ['s2.e+0.2', 1], ['s2.e+0.21', 0], ['s9.1-0.61', 0], ['s9.1-0.6', .5], ['end+0.5', .5], ['end+0.51', 0]]),
    rot: track([['s2', [-1.4, 0.9, 0.3]], ['s2+1.3', [0.06, -0.42, 0.03], 'oe'], ['s2.e-0.4', [0.03, -0.28, 0.02]], ['s2.e+0.2', [0.4, -1, 0], 'ic'],
      ['s9.1-0.6', [0, 1.4, 0]], ['s9.1+0.35', [0.05, 0.4, 0], 'oe'], ['end+0.5', [0.05, 0.4, 0]]]),
    phase: 3.1, idle: .5,
  },
  five: {
    pos: track([['s4.1-0.3', [-3.2, 0.6, -14]], ['s4.1+0.7', [-3.25, 0.55, 0], 'oe'], ['s4.e-0.4', [-3.25, 0.55, 0]], ['s4.e+0.2', [-3.25, 6, -2], 'ic'],
      ['s8.1-0.3', [-3.5, 0.5, -14]], ['s8.1+0.6', [-3.55, 0.5, 0], 'oe'], ['s8.e-0.4', [-3.55, 0.5, 0]], ['s8.e+0.2', [-3.5, -6, -2], 'ic']]),
    scale: track([['s4.1-0.31', 0], ['s4.1-0.3', 1], ['s4.e+0.2', 1], ['s4.e+0.21', 0], ['s8.1-0.31', 0], ['s8.1-0.3', .85], ['s8.e+0.2', .85], ['s8.e+0.21', 0]]),
    rot: track([['s4.1-0.3', [0, -PI2 * 2, 0]], ['s4.1+0.7', [0, 0.28, 0], 'oe'], ['s4.e', [0, 0.22, 0]], ['s8.1-0.3', [0, PI2 * 2, 0]], ['s8.1+0.6', [0, 0.3, 0], 'oe']]),
    phase: 2.3,
  },
};
const OBJ = { st, jp, card, five };
function applyObj(name, t) {
  const o = OBJ[name], tr = T[name];
  const s = sample(tr.scale, t);
  o.visible = s > .001;
  if (!o.visible) return;
  const p = sample(tr.pos, t), r = sample(tr.rot, t), ph = tr.phase, k = tr.idle ?? 1;
  o.position.set(p[0], p[1] + Math.sin(t * 1.1 + ph) * .045 * k, p[2]);
  o.rotation.set(r[0] + Math.sin(t * .55 + ph) * .07 * k, r[1] + Math.sin(t * .8 + ph) * .13 * k, r[2]);
  o.scale.setScalar(s);
}

// camera
const camIntro = track([['s1', [0, 1.6, 26]], ['s1+3.4', [0, 0, 10.3], 'oc']]);
function sceneAt(t) { let s = TL.scenes[0]; for (const x of TL.scenes) if (t >= x.start) s = x; return s; }
function updateCamera(t) {
  const sc = sceneAt(t), sp = clamp((t - sc.start) / (sc.end - sc.start));
  let pos = [Math.sin(t * .23) * .22, Math.sin(t * .31) * .12, 10.35 - .6 * E.io(sp)];
  if (t < R('s1+3.4')) { const ci = sample(camIntro, t); pos = [ci[0] + pos[0] * .3, ci[1], ci[2]]; }
  const p = pulse(t, .32);
  pos[2] += p * 1.4;
  camera.position.set(...pos);
  camera.lookAt(pos[0] * .4, pos[1] * .3, 0);
  const idx = TRANSITIONS.findIndex(c => Math.abs(t - c) < 1);
  camera.rotateZ((idx % 2 ? -1 : 1) * pulse(t, .22) * .05);
  camera.fov = 35 + p * 7; camera.updateProjectionMatrix();
}

// warp speed integral
function warpSpeed(t) {
  const intro = t < 3.2 ? 26 * (1 - E.oc(t / 3.2)) : 0;
  const end = t > R('end') ? 0 : 0;
  return 1.2 + intro + pulse(t, .35) * 30 + end;
}
function warpOffset(t) { let a = 0; const dt = 1 / 120; for (let x = 0; x < t; x += dt) a += warpSpeed(x) * Math.min(dt, t - x); return a; }

// coin choreography per scene
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc3 = new THREE.Vector3(), eul = new THREE.Euler();
function setCoin(i, x, y, z, s, rx, ry, rz) { eul.set(rx, ry, rz); q.setFromEuler(eul); sc3.setScalar(s); v3.set(x, y, z); m4.compose(v3, q, sc3); coins.setMatrixAt(i, m4); }
function updateCoins(t) {
  for (let i = 0; i < COINS; i++) setCoin(i, 0, 0, 0, 0, 0, 0, 0);
  // S2: orbiting ring of payments around the bond card
  const a2 = R('s2.1+0.6'), b2 = R('s2.e');
  if (t > a2 - .1 && t < b2 + .3 && card.visible) {
    const n = 22;
    for (let i = 0; i < n; i++) {
      const app = E.ob(clamp((t - a2 - i * .06) / .5)), out = 1 - E.ic(clamp((t - b2 + .45) / .5));
      const a = t * .55 + i / n * PI2;
      const c = card.position;
      setCoin(i, c.x + Math.cos(a) * 2.35, c.y - .15 + Math.sin(a) * .42, c.z + Math.sin(a) * 1.25, .62 * app * out, Math.PI / 2 * .2, t * 2.2 + i, 0);
    }
  }
  // S5: coins zipping along the JPYSC lane
  const a5 = R('s5.2'), b5 = R('s5.e');
  if (t > a5 && t < b5 + .3) {
    const n = 16, draw = E.io(clamp((t - a5) / 1.2)), fade = 1 - clamp((t - b5 + .4) / .4);
    for (let i = 0; i < n; i++) {
      const u = (t * .16 + i / n) % 1; if (u > draw) continue;
      laneChain.curve.getPointAt(u, v3); const s = Math.sin(Math.PI * u) ** .6 * .75 * fade;
      setCoin(i, v3.x, v3.y, v3.z + .05, s, 0, t * 4 + i, 0);
    }
  }
  // S9: double helix along the bridge
  const a9 = R('s9.1+0.8'), b9 = R('end+0.4');
  if (t > a9 && t < b9) {
    const n = 26, draw = E.io(clamp((t - a9) / 1.4)), fade = 1 - clamp((t - b9 + .5) / .5);
    for (let i = 0; i < n; i++) {
      const u = (t * .09 + i / n) % 1; if (u > draw) continue;
      bridge.curve.getPointAt(u, v3); const ph = u * 16 - t * 2 + (i % 2) * Math.PI; const s = Math.sin(Math.PI * u) ** .5 * .5 * fade;
      setCoin(i, v3.x, v3.y + Math.cos(ph) * .3, v3.z + Math.sin(ph) * .3, s, 0, t * 3 + i, 0);
    }
  }
  coins.instanceMatrix.needsUpdate = true;
}

// ───────────────────────── DOM timeline
const stage = document.getElementById('stage');
const scenesDom = [...document.querySelectorAll('.scene')].map(el => ({ el, id: el.dataset.scene, start: SC[el.dataset.scene].start, end: SC[el.dataset.scene].end }));
function splitWords(root) {
  const words = [];
  const walk = (node, cls) => {
    [...node.childNodes].forEach(ch => {
      if (ch.nodeType === 3) {
        const frag = document.createDocumentFragment();
        ch.textContent.split(/(\s+)/).forEach(tok => {
          if (!tok) return;
          if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); return; }
          const w = document.createElement('span'); w.className = 'w';
          const wi = document.createElement('span'); wi.className = 'wi' + (cls ? ' ' + cls : ''); wi.textContent = tok;
          w.appendChild(wi); frag.appendChild(w); words.push(wi);
        });
        ch.replaceWith(frag);
      } else if (ch.nodeType === 1 && ch.tagName !== 'BR') {
        const c = ch.className; walk(ch, c);
        if (c) ch.className = ''; // class moved to the words
      }
    });
  };
  walk(root, '');
  return words;
}
const animEls = [...document.querySelectorAll('[data-in],[data-out]')].map(el => {
  const o = { el, tin: el.dataset.in ? R(el.dataset.in) : -1e9, dur: +(el.dataset.dur || (el.classList.contains('split') ? .75 : .85)), fx: el.dataset.fx || (el.classList.contains('split') ? 'words' : 'up'), tout: el.dataset.out ? R(el.dataset.out) : null };
  if (o.fx === 'words') { o.words = splitWords(el); o.stagger = +(el.dataset.stagger || .07); }
  if (el.dataset.count) { o.count = +el.dataset.count; o.dec = +(el.dataset.dec || 0); o.cdur = +(el.dataset.cdur || 1.2); }
  return o;
});
const anchors = [...document.querySelectorAll('[data-anchor]')];
const fmt = (v, d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

function applyEl(o, t) {
  const { el } = o;
  if (o.count !== undefined) { const p = E.oe(clamp((t - o.tin) / o.cdur)); el.textContent = fmt(o.count * p, o.dec); if (o.fx === 'up' && el.tagName === 'SPAN') return; }
  let outQ = o.tout !== null ? E.ic(clamp((t - o.tout) / .4)) : 0;
  if (o.fx === 'words') {
    o.words.forEach((w, i) => {
      const p = clamp((t - o.tin - i * o.stagger) / o.dur), e = E.oe(p);
      w.style.transform = `translate3d(0,${(1 - e) * 112}%,0) rotate(${(1 - e) * 7}deg)`;
      w.style.opacity = e;
      w.parentNode.style.overflow = e < .999 ? 'hidden' : 'visible';
    });
    el.style.opacity = 1 - outQ; el.style.transform = outQ ? `translateY(${-outQ * 24}px)` : '';
    return;
  }
  const p = clamp((t - o.tin) / o.dur), e = E.oe(p);
  let tr = '', op = e, filt = '';
  switch (o.fx) {
    case 'up': tr = `translate3d(0,${(1 - e) * 46}px,0)`; filt = e < 1 ? `blur(${(1 - e) * 12}px)` : ''; break;
    case 'left': tr = `translate3d(${(1 - e) * -70}px,0,0)`; filt = e < 1 ? `blur(${(1 - e) * 10}px)` : ''; break;
    case 'right': tr = `translate3d(${(1 - e) * 110}px,0,0) perspective(800px) rotateY(${(1 - e) * -25}deg)`; filt = e < 1 ? `blur(${(1 - e) * 10}px)` : ''; break;
    case 'fade': break;
    case 'pop': { const b = E.ob(p); tr = `scale(${.55 + .45 * b})`; op = clamp(p * 3); break; }
    case 'stamp': { const b = E.oe(clamp((t - o.tin) / .38)); tr = `scale(${2.6 - 1.6 * b})`; op = clamp((t - o.tin) / .15); break; }
    case 'wipe': el.style.clipPath = `inset(0 ${(1 - e) * 100}% 0 0)`; op = 1; break;
    case 'strike': tr = `scaleX(${E.oe(clamp((t - o.tin) / .6))})`; op = p > 0 ? 1 : 0; break;
    case 'sheen': tr = `translateX(${-120 + 240 * clamp((t - o.tin) / 1.1)}%)`; op = 1; break;
  }
  if (outQ) { op *= 1 - outQ; tr += ` translateY(${-outQ * 24}px)`; }
  el.style.opacity = op; el.style.transform = tr; el.style.filter = filt;
}

const proj = new THREE.Vector3();
function toScreen(v) { proj.copy(v).project(camera); return [(proj.x + 1) / 2 * W, (1 - proj.y) / 2 * H]; }
const tmpV = new THREE.Vector3();
const ANCHOR = {
  xmark: () => tmpV.set(0, 0.85, 0),
  fiveLbl: () => tmpV.copy(five.position).add(new THREE.Vector3(0, -1.2, 0)),
  guarantee: () => tmpV.copy(st.position).add(new THREE.Vector3(0.72, 0, 0)),
  issuerLbl: () => tmpV.copy(st.position).add(new THREE.Vector3(0, -0.98, 0)),
  investorLbl: () => tmpV.copy(holders.position).add(new THREE.Vector3(0, -1.08, 0)),
  bankLbl: () => tmpV.set(0, 0.55, 0),
  chainLbl: () => tmpV.set(0, -2.02, 0.35),
  sat0: () => sats[0].getWorldPosition(tmpV).add(new THREE.Vector3(0, .36, 0)),
  sat1: () => sats[1].getWorldPosition(tmpV).add(new THREE.Vector3(0, .36, 0)),
  sat2: () => sats[2].getWorldPosition(tmpV).add(new THREE.Vector3(0, .36, 0)),
  sat3: () => sats[3].getWorldPosition(tmpV).add(new THREE.Vector3(0, .36, 0)),
  sbiNode: () => tmpV.set(3.75, 0.4, 0),
  stLbl7: () => tmpV.copy(st.position).add(new THREE.Vector3(0, -1.0, 0)),
  sbiLbl7: () => tmpV.set(3.75, -0.6, 0),
  jpLbl7: () => tmpV.copy(jp.position).add(new THREE.Vector3(0, -1.35, 0)),
  stampA: () => tmpV.copy(five.position).add(new THREE.Vector3(0, -1.25, .5)),
  tradLbl: () => tmpV.set(-3.7, -1.55, 0),
  chainLbl9: () => tmpV.set(3.7, -1.55, 0),
  xmarkEnd: () => tmpV.set(0, 0.55, 0),
};

// HUD
const CH_NAMES = { s1: 'INTRO', s2: 'THE LAUNCH', s3: 'THE QUESTION', s4: 'KEY NUMBERS', s5: 'INNOVATION', s6: 'WHY IT MATTERS', s7: 'THE SBI FACTOR', s8: 'RISKS', s9: 'BOTTOM LINE', end: 'STARTALE BOND' };
const bar = document.getElementById('bar');
TL.scenes.forEach(() => { const i = document.createElement('i'); i.appendChild(document.createElement('b')); bar.appendChild(i); });
const hud = document.getElementById('hud'), chNum = document.getElementById('chNum'), chName = document.getElementById('chName'), hudTime = document.getElementById('hudTime');
const flash = document.getElementById('flash'), black = document.getElementById('black'), dom = document.getElementById('dom');
const grainEl = document.getElementById('grain');
{
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const im = g.createImageData(256, 256); const r = rng(3);
  for (let i = 0; i < im.data.length; i += 4) { const v = r() * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  g.putImageData(im, 0, 0); grainEl.style.backgroundImage = `url(${c.toDataURL()})`;
}

function updateDOM(t) {
  for (const s of scenesDom) {
    const on = t >= s.start - .02 && t < s.end + .02;
    s.el.style.display = on ? 'block' : 'none';
    if (!on) continue;
    const q = s.id === 'end' ? 0 : E.ic(clamp((t - (s.end - .42)) / .42));
    s.el.style.opacity = 1 - q;
    s.el.style.filter = q > 0 ? `blur(${q * 14}px)` : '';
    s.el.style.transform = q > 0 ? `scale(${1 + q * .05})` : '';
  }
  for (const o of animEls) { if (o.el.closest('.scene').style.display !== 'none') applyEl(o, t); }
  for (const a of anchors) {
    if (a.closest('.scene').style.display === 'none') continue;
    const [x, y] = toScreen(ANCHOR[a.dataset.anchor]());
    a.style.left = x + 'px'; a.style.top = y + 'px';
  }
  // satellite labels dim on the far side of the orbit
  sats.forEach((s, i) => { const a = document.querySelector(`[data-anchor=sat${i}]`); const z = s.getWorldPosition(tmpV).z - orbit.position.z; a.style.opacity = .45 + .55 * clamp(.5 + z / 1.2); });

  // HUD
  const sc = sceneAt(t), idx = TL.scenes.indexOf(sc);
  chNum.textContent = String(idx + 1).padStart(2, '0'); chName.textContent = CH_NAMES[sc.id];
  [...bar.children].forEach((el, i) => { const s = TL.scenes[i]; el.firstChild.style.width = clamp((t - s.start) / (s.end - s.start)) * 100 + '%'; });
  const sec = Math.floor(t); hudTime.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  hud.style.opacity = clamp((t - 1.2) / 1) * (1 - clamp((t - R('end+1.5')) / .8) * .6);

  // transition flash, glitch, fade to black
  flash.style.opacity = TRANSITIONS.reduce((a, c) => a + gauss(t, c, .09), 0) * .6 + gauss(t, 3.0, .12) * .45;
  const g = gauss(t, R('s8'), .22) + gauss(t, R('s8+0.45'), .07) * .6;
  const fi = Math.floor(t * 30), r = rng(fi + 11);
  dom.style.transform = g > .05 ? `translate(${(r() - .5) * 40 * g}px,${(r() - .5) * 10 * g}px)` : '';
  dom.style.textShadow = g > .05 ? `${-6 * g}px 0 rgba(255,60,60,.8), ${6 * g}px 0 rgba(60,200,255,.8)` : '';
  rgbShift.uniforms.amount.value = g * .012 + pulse(t, .12) * .0025;
  rgbShift.uniforms.angle.value = r() * Math.PI * 2;
  rgbShift.enabled = rgbShift.uniforms.amount.value > .0002;
  black.style.opacity = Math.max(1 - clamp(t / .5), clamp((t - (DURATION - .9)) / .8));
  grainEl.style.transform = `translate(${(r() * 64) | 0}px,${(r() * 64) | 0}px)`;
}

// ───────────────────────── per-frame world update
let warpCache = { t: -1, v: 0 };
function frame(t) {
  updateCamera(t);
  for (const n of Object.keys(OBJ)) applyObj(n, t);
  updateCoins(t);
  updateBubbles(t);

  const warm = E.io(clamp((t - R('s8-0.15')) / .7)) * (1 - E.io(clamp((t - R('s8.e-0.3')) / .7)));
  bgMat.uniforms.uTime.value = t; bgMat.uniforms.uWarm.value = warm; bgMat.uniforms.uBoost.value = pulse(t, .3);
  amberL.intensity = warm * 35; rimBlue.intensity = 60 * (1 - warm * .5);
  fiveMat.color.set(warm > .5 ? '#ffd6cc' : '#e9e4ff');
  five.userData.halo.material.color.set(warm > .5 ? '#ffd0c8' : '#ffffff');
  gridMat.uniforms.uColor.value.set(warm > .5 ? '#ff7a6b' : '#8f7dff');
  partMat.uniforms.uA.value.set(warm > .5 ? '#ff8a7a' : '#9b8cff');

  // warp
  const w = warpOffset(t);
  partMat.uniforms.uTime.value = t; partMat.uniforms.uWarp.value = w;
  const ws = warpSpeed(t), wI = clamp((ws - 3) / 18);
  streakMat.opacity = wI * .6; streaks.visible = wI > .01;
  if (streaks.visible) {
    for (let i = 0; i < STREAKS; i++) {
      const [x, y, z0] = streakSeed[i]; const z = ((z0 + w * 1.6) % 90) - 80;
      setStreak(i, x, y, z, 1 + ws * .35);
    }
    streaks.instanceMatrix.needsUpdate = true;
  }
  gridMat.uniforms.uScroll.value = -w * .6; gridMat.uniforms.uTime.value = t;
  const sc = sceneAt(t);
  const gridBase = { s1: 1, s2: .35, s3: .5, s4: .3, s5: .22, s6: .3, s7: .3, s8: .45, s9: .4, end: .8 }[sc.id];
  gridMat.uniforms.uOp.value = clamp(t / 2.5) * (gridBase + pulse(t, .4) * .8);

  bloom.strength = .25 + pulse(t, .3) * .25 + (t < 3.5 ? (1 - t / 3.5) * .2 : 0);

  // halos breathing
  jp.userData.halo.material.opacity = .55 + .1 * Math.sin(t * 1.7);
  st.userData.halo.material.opacity = .45 + .08 * Math.sin(t * 1.3 + 1);

  // S5 lanes & holders
  const s5a = R('s5.1'), s5b = R('s5.2'), s5e = R('s5.e');
  const laneOut = 1 - clamp((t - s5e + .5) / .5);
  laneBank.update(t, { op: (t > s5a - .2 ? 1 : 0) * laneOut * (t > s5b ? lerp(1, .35, clamp((t - s5b) / .8)) : 1), draw: E.io(clamp((t - s5a + .2) / 1.6)), speed: .035 });
  laneChain.update(t, { op: (t > s5b ? 1 : 0) * laneOut, draw: E.io(clamp((t - s5b) / 1.0)), speed: .2 });
  const hIn = E.ob(clamp((t - R('s5+0.3')) / .8)) * laneOut;
  holders.visible = hIn > .01 && t < s5e + .1;
  if (holders.visible) {
    holders.position.set(...HOLDERS); holders.scale.setScalar(hIn * .9);
    holders.userData.r1.rotation.set(t * .6, t * .4, 0); holders.userData.r2.rotation.set(-t * .3, t * .5, 0);
    for (let i = 0; i < 7; i++) { const a = i / 7 * PI2 + t * .5, rr = i ? .32 : 0; setInst(holderDots, i, Math.cos(a) * rr, Math.sin(a) * rr, Math.sin(a * 2) * .1, 1); }
    holderDots.instanceMatrix.needsUpdate = true;
  }
  // S6 orbit
  const o6 = E.oe(clamp((t - R('s6.2')) / 1.2)) * (1 - E.ic(clamp((t - R('s6.e') + .45) / .45)));
  orbit.visible = o6 > .01;
  if (orbit.visible) {
    orbit.position.copy(jp.position); orbit.rotation.set(1.05, -0.25, 0.12); orbit.scale.setScalar(.4 + .6 * o6);
    orbitRing.material.opacity = .7 * o6;
    sats.forEach((s, i) => {
      const appear = E.ob(clamp((t - R('s6.2') - [1.4, 2.3, 3.3, 4.2][i]) / .5));
      const a = t * .12 + i * Math.PI / 2 + 0.6;
      s.position.set(Math.cos(a) * 1.62, Math.sin(a) * 1.62, 0); s.scale.setScalar(appear);
    });
  }
  // S7 beams + SBI ring
  const s7a = R('s7.1+0.3'), s7e = R('s7.e');
  const b7 = 1 - clamp((t - s7e + .45) / .4);
  beamL.update(t, { op: (t > s7a ? 1 : 0) * b7, draw: E.io(clamp((t - s7a) / 1)), speed: .45 });
  beamR.update(t, { op: (t > s7a + 1 ? 1 : 0) * b7, draw: E.io(clamp((t - s7a - 1) / 1)), speed: .45 });
  const sb = E.ob(clamp((t - R('s7.1+1.2')) / .7)) * b7;
  sbiRing.visible = sb > .01 && t < s7e + .1 && t > R('s7');
  if (sbiRing.visible) { sbiRing.position.set(3.75, 0.4, 0); sbiRing.scale.setScalar(sb * .95); sbiRing.userData.r1.rotation.set(t * .5, t * .3, 0); sbiRing.userData.r2.rotation.set(-t * .4, t * .6, 0); }
  // S9 bridge
  const s9a = R('s9.1+0.5'), s9e = R('end+0.5');
  bridge.update(t, { op: (t > s9a ? 1 : 0) * (1 - clamp((t - s9e + .5) / .5)), draw: E.io(clamp((t - s9a) / 1.2)), speed: .14 });

  updateDOM(t);
  composer.render();
}
function setStreak(i, x, y, z, len) { v3.set(x, y, z); q.identity(); sc3.set(1, 1, len); m4.compose(v3, q, sc3); streaks.setMatrixAt(i, m4); }
function setInst(mesh, i, x, y, z, s) { v3.set(x, y, z); q.identity(); sc3.setScalar(s); m4.compose(v3, q, sc3); mesh.setMatrixAt(i, m4); }

// ───────────────────────── boot
await document.fonts.ready;
await Promise.all(['800', '700', '600', '500', '900', '300'].map(w => document.fonts.load(`${w} 40px "Inter Display"`)));
await buildCard();
await buildFive();

function fit() { const s = Math.min(innerWidth / W, innerHeight / H); stage.style.transform = `scale(${s})`; stage.style.left = (innerWidth - W * s) / 2 + 'px'; stage.style.top = (innerHeight - H * s) / 2 + 'px'; }
const params = new URLSearchParams(location.search);
window.__duration = DURATION;
window.__render = t => { frame(t); return true; };
if (!params.has('capture')) {
  fit(); addEventListener('resize', fit);
  if (params.has('t')) frame(+params.get('t'));
  else { const t0 = performance.now(); const loop = () => { frame(((performance.now() - t0) / 1000) % DURATION); requestAnimationFrame(loop); }; loop(); }
}
window.__ready = true;
