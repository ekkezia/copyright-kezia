// --------------------------------------------
// CONFIG
// --------------------------------------------
const OUT_W = 24;
const OUT_H = 32;

let img;
let pixelData = [];

let picker;
let pickedX = -1;
let pickedY = -1;

let inp, btn;

// --------------------------------------------
function preload() {
  img = loadImage("image.jpg"); // <-- replace with your file
}

// --------------------------------------------
function setup() {
  createCanvas(480, 640);

  // --- IMPORT UI (must be inside setup!) ---
  inp = createInput("", "text");
  inp.position(10, 10);
  inp.size(350);

  btn = createButton("IMPORT RGB ARRAY");
  btn.position(370, 10);
  btn.mousePressed(() => importPanels(inp.value()));

  // --- Read initial pixels ---
  img.resize(OUT_W, OUT_H);
  img.loadPixels();

  pixelData = [];
  for (let y = 0; y < OUT_H; y++) {
    let row = [];
    for (let x = 0; x < OUT_W; x++) {
      let idx = (y * OUT_W + x) * 4;
      row.push([
        img.pixels[idx],
        img.pixels[idx + 1],
        img.pixels[idx + 2],
      ]);
    }
    pixelData.push(row);
  }

  // Color picker
  picker = createColorPicker("#ffffff");
  picker.position(-200, -200); // hidden initially
  picker.input(applyPickedColor);
}

// --------------------------------------------
// APPLY PICKED COLOR
// --------------------------------------------
function applyPickedColor() {
  if (pickedX === -1) return;

  let c = picker.color();
  pixelData[pickedY][pickedX] = [red(c), green(c), blue(c)];
}

// --------------------------------------------
// CLICK TO SELECT PIXEL + OPEN PICKER
// --------------------------------------------
function mousePressed() {
  if (clickInsidePicker()) return;

  const cellW = width / OUT_W;
  const cellH = height / OUT_H;

  let x = floor(mouseX / cellW);
  let y = floor(mouseY / cellH);

  if (x < 0 || x >= OUT_W || y < 0 || y >= OUT_H) return;

  pickedX = x;
  pickedY = y;

  picker.position(mouseX + 10, mouseY + 10);

  let [r, g, b] = pixelData[y][x];
  picker.value(color(r, g, b));
}

function clickInsidePicker() {
  const px = picker.x, py = picker.y;
  const pw = picker.width, ph = picker.height;
  return (mouseX >= px && mouseX <= px + pw &&
          mouseY >= py && mouseY <= py + ph);
}

// --------------------------------------------
// MAIN DRAW
// --------------------------------------------
function draw() {
  background(255);

  const cellW = width / OUT_W;
  const cellH = height / OUT_H;

  const PANEL_COUNT = 3;
  const PANEL_W = OUT_W / PANEL_COUNT; // = 8

  textAlign(CENTER, CENTER);
  textSize(min(cellW, cellH) * 0.35);

  // Draw pixels + snake index
  for (let y = 0; y < OUT_H; y++) {
    for (let x = 0; x < OUT_W; x++) {
      let [r, g, b] = pixelData[y][x];

      stroke(255, 0, 0);
      strokeWeight(1);
      fill(r, g, b);
      rect(x * cellW, y * cellH, cellW, cellH);

      // snake index
      const PANEL_W = 8;
      const panelIndex = floor(x / PANEL_W);
      const localX = x % PANEL_W;

      let idx = (y % 2 === 0)
        ? (y * PANEL_W + (PANEL_W - 1 - localX)) // even rows reversed
        : (y * PANEL_W + localX);

      noStroke();
      fill(255, 0, 0);
      text(idx, x * cellW + cellW / 2, y * cellH + cellH / 2);
    }
  }

  // Draw big green borders
  const colW = width / 3;
  stroke(0, 255, 0);
  strokeWeight(3);
  noFill();
  for (let i = 0; i < 3; i++) rect(i * colW, 0, colW, height);
}

// --------------------------------------------
// KEY SHORTCUTS
// --------------------------------------------
function keyPressed() {
  if (key === 'e') exportPanels();
}

// --------------------------------------------
// EXPORT PANELS in SNAKE ORDER
// --------------------------------------------
function exportPanels() {
  const PANEL_COUNT = 3;
  const PANEL_W = OUT_W / PANEL_COUNT; // 24 / 3 = 8

  let result = []; // this will be [panel0[256], panel1[256], panel2[256]]

  for (let p = 0; p < PANEL_COUNT; p++) {
    let panelArray = [];

    for (let y = 0; y < OUT_H; y++) {
      for (let lx = 0; lx < PANEL_W; lx++) {

        // snake within this panel
        let xFinal = (y % 2 === 0)
          ? (p * PANEL_W + (PANEL_W - 1 - lx))  // even rows reversed
          : (p * PANEL_W + lx);                 // odd rows forward

        const [r, g, b] = pixelData[y][xFinal];
        panelArray.push([r, g, b]); // push one RGB triplet
      }
    }

    // panelArray now has exactly 32 * 8 = 256 pixels
    result.push(panelArray);
  }

  console.log("RGB EXPORT:", JSON.stringify(result, null, 2));
  console.log("Shape check:", result.length, result[0].length, result[1].length, result[2].length);
  // should log: 3 256 256 256
}


// --------------------------------------------
// IMPORT PANELS (snake order input)
// --------------------------------------------
function importPanels(jsonText) {
  let data;

  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    console.error("Invalid JSON");
    return;
  }

  if (!Array.isArray(data) || data.length !== 3) {
    console.error("Expected 3 panels");
    return;
  }

  const PANEL_COUNT = 3;
  const PANEL_W = OUT_W / PANEL_COUNT;

  for (let p = 0; p < PANEL_COUNT; p++) {
    let arr = data[p];
    if (!Array.isArray(arr) || arr.length !== OUT_H * PANEL_W) {
      console.error("Panel", p, "size incorrect");
      return;
    }

    let i = 0;
    for (let y = 0; y < OUT_H; y++) {
      for (let lx = 0; lx < PANEL_W; lx++) {

        let xFinal = (y % 2 === 0)
          ? (p * PANEL_W + (PANEL_W - 1 - lx))
          : (p * PANEL_W + lx);

        pixelData[y][xFinal] = [...arr[i]];
        i++;
      }
    }
  }

  console.log("Import complete!");
}
