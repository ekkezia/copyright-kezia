/* 
p5.js + ml5 FaceMesh
Camera + Toggleable Mona Lisa fallback
LED mask + serial sender
+ Anti-blue camera filter
*/

// =====================================================
// LED MATRIX CONFIG
// =====================================================
const W = 24;
const H = 32;
const gridSize = 20;

// =====================================================
// GLOBALS
// =====================================================
let capture;
let fallbackImg;
let faceMesh;

let faces = [];
let monaKeypoints = [];
let monaReady = false;

// --- fallback control ---
let ENABLE_MONA_FALLBACK = true;
let useFallback = false;
let NO_FACE_COUNT = 0;
const NO_FACE_THRESHOLD = 20;

// --- serial ---
let port, writer;
let lastSent = 0;
const sendInterval = 50;

// --- debug ---
let DEBUG_FACE = false;

// --- UI ---
let brightnessSlider;
let blueSlider;

// --- color balance ---
let RED_MULT = 1.05;
let GREEN_MULT = 1.02;

// =====================================================
// OBJECT-FIT COVER STATE
// =====================================================
let coverOffsetX = 0;
let coverOffsetY = 0;
let coverDrawW = 0;
let coverDrawH = 0;
let coverScale = 1;

// =====================================================
// PRELOAD
// =====================================================
function preload() {
  fallbackImg = loadImage("monalisa.png");

  faceMesh = ml5.faceMesh({
    maxFaces: 1,
    refineLandmarks: false,
    flipHorizontal: false
  });
}

// =====================================================
// SETUP
// =====================================================
function setup() {
  pixelDensity(1);
  createCanvas(W * gridSize, H * gridSize);

  capture = createCapture({ video: true, audio: false });
  capture.size(640, 480);
  capture.hide();

  // ---------------- Face detection (live camera)
  faceMesh.detectStart(capture, res => {
    faces = res;

    if (faces.length > 0) {
      NO_FACE_COUNT = 0;
      useFallback = false;
    } else {
      NO_FACE_COUNT++;
      useFallback =
        ENABLE_MONA_FALLBACK &&
        NO_FACE_COUNT > NO_FACE_THRESHOLD &&
        monaReady;
    }
  });

  // ---------------- One-shot Mona Lisa detection
  faceMesh.detect(fallbackImg, res => {
    if (res.length > 0) {
      monaKeypoints = res[0].keypoints;
      monaReady = true;
    }
  });

  // ---------------- UI
  createButton("Connect Serial")
    .position(10, 10)
    .mousePressed(connectSerial);

  const monaBtn = createButton("Mona Fallback: ON");
  monaBtn.position(10, 40);
  monaBtn.mousePressed(() => {
    ENABLE_MONA_FALLBACK = !ENABLE_MONA_FALLBACK;
    monaBtn.html(
      ENABLE_MONA_FALLBACK ? "Mona Fallback: ON" : "Mona Fallback: OFF"
    );
    if (!ENABLE_MONA_FALLBACK) {
      useFallback = false;
      NO_FACE_COUNT = 0;
    }
  });

  brightnessSlider = createSlider(0, 200, 100);
  brightnessSlider.position(10, 70);
  brightnessSlider.style("width", "150px");

  blueSlider = createSlider(60, 100, 85);
  blueSlider.position(10, 100);
  blueSlider.style("width", "150px");
}

// =====================================================
// SERIAL
// =====================================================
async function connectSerial() {
  port = await navigator.serial.requestPort();
  await port.open({ baudRate: 115200 });
  writer = port.writable.getWriter();
}

// =====================================================
// OBJECT-FIT COVER
// =====================================================
function objectFitCover(src, destW, destH) {
  let sw = src.width;
  let sh = src.height;

  let srcAspect = sw / sh;
  let destAspect = destW / destH;

  if (srcAspect > destAspect) {
    coverDrawH = destH;
    coverDrawW = coverDrawH * srcAspect;
  } else {
    coverDrawW = destW;
    coverDrawH = coverDrawW / srcAspect;
  }

  coverOffsetX = (destW - coverDrawW) / 2;
  coverOffsetY = (destH - coverDrawH) / 2;
  coverScale = coverDrawW / sw;

  push();
  translate(destW, 0);
  scale(-1, 1);
  image(src, coverOffsetX, coverOffsetY, coverDrawW, coverDrawH);
  pop();
}

// =====================================================
// IMAGE → LED MAPPING
// =====================================================
function imagePointToLED(x, y) {
  let cx = width - (x * coverScale + coverOffsetX);
  let cy = y * coverScale + coverOffsetY;

  return {
    x: floor((cx / width) * W),
    y: floor((cy / height) * H)
  };
}

// =====================================================
// FACE MASK
// =====================================================
function computeFaceMask() {
  let keypoints = [];

  if (useFallback) {
    if (!monaReady) return [];
    keypoints = monaKeypoints;
  } else {
    if (faces.length === 0) return [];
    keypoints = faces[0].keypoints;
  }

  let pts = [];
  for (let k of keypoints) {
    let p = imagePointToLED(k.x, k.y);
    if (p.x >= 0 && p.x < W && p.y >= 0 && p.y < H) pts.push(p);
  }

  if (pts.length < 3) return [];
  return fillHull(convexHull(pts));
}

// =====================================================
// CONVEX HULL
// =====================================================
function convexHull(points) {
  points = points.slice().sort((a, b) =>
    a.x === b.x ? a.y - b.y : a.x - b.x
  );

  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  let lower = [];
  for (let p of points) {
    while (lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  let upper = [];
  for (let i = points.length - 1; i >= 0; i--) {
    let p = points[i];
    while (upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// =====================================================
// FILL HULL
// =====================================================
function fillHull(hull) {
  let out = [];
  let minY = Math.min(...hull.map(p => p.y));
  let maxY = Math.max(...hull.map(p => p.y));

  for (let y = minY; y <= maxY; y++) {
    let xs = [];
    for (let i = 0; i < hull.length; i++) {
      let a = hull[i];
      let b = hull[(i + 1) % hull.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        let t = (y - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }

    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i += 2) {
      for (let x = ceil(xs[i]); x <= floor(xs[i + 1]); x++) {
        out.push({
          row: y,
          col: 7 - (x % 8),
          strip: floor(x / 8)
        });
      }
    }
  }
  return out;
}

// =====================================================
// DRAW
// =====================================================
function draw() {
  background(0);

  if (useFallback && ENABLE_MONA_FALLBACK) {
    objectFitCover(fallbackImg, width, height);
  } else {
    objectFitCover(capture, width, height);
  }

  // -------- anti-blue filter --------
  let BLUE_MULT = blueSlider.value() / 100;

  loadPixels();
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i + 0] = min(255, pixels[i + 0] * RED_MULT);
    pixels[i + 1] = min(255, pixels[i + 1] * GREEN_MULT);
    pixels[i + 2] = min(255, pixels[i + 2] * BLUE_MULT);
  }
  updatePixels();

  // -------- LED grid render --------
  let b = brightnessSlider.value() / 100;
  noStroke();

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = get(
        x * gridSize + gridSize / 2,
        y * gridSize + gridSize / 2
      );
      fill(c[0] * b, c[1] * b, c[2] * b);
      rect(x * gridSize, y * gridSize, gridSize, gridSize);
    }
  }

  if (DEBUG_FACE) {
    fill(255, 0, 0, 120);
    for (let p of computeFaceMask()) {
      let x = p.strip * 8 + (7 - p.col);
      rect(x * gridSize, p.row * gridSize, gridSize, gridSize);
    }
  }

  if (millis() - lastSent > sendInterval) {
    sendFrame();
    lastSent = millis();
  }
}

// =====================================================
// SEND FRAME
// =====================================================
async function sendFrame() {
  if (!writer) return;

  let parts = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = get(
        x * gridSize + gridSize / 2,
        y * gridSize + gridSize / 2
      );
      parts.push(y, 7 - (x % 8), floor(x / 8), c[0], c[1], c[2]);
    }
  }

  await writer.write(
    new TextEncoder().encode("FRAME:" + parts.join(",") + "\n")
  );

  let mask = computeFaceMask();
  let maskStr = mask.map(p => `${p.row},${p.col},${p.strip}`).join(";");
  await writer.write(
    new TextEncoder().encode("FACE:" + maskStr + "\n")
  );
}
