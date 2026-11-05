// ============================================================
// WEB VERSION of flicker_teensy_1x8x32_0910
// ============================================================
//
// Same sketch as flicker_teensy_1x8x32_0910, plus input from the
// website (../../web). Both inputs work at the same time:
//
//   CYD touch LCD  -> Serial1 (pins 0/1)   -> handleCommand()
//   Website        -> same site open in Chrome on the laptop (Web Serial)
//                  -> USB Serial -> handleCommand()
//
// The website sends one line per submission:
//
//   M<256 x 0|1>\n      1 = flicker pixel (drawn black on the site)
//
// Extra commands added in this version:
//
//   C            clear the mask (nothing flickers)
//   D<pct>       modulating (flicker) pixel brightness, 0-100 %, default 100
//   A            steady pixels auto-match the flicker brightness again
//                (B<pct> switches auto-match off and sets them by hand)
//
// After each command from USB the Teensy prints "OK <cmd>" or
// "ERR <cmd>" so the website can log whether the matrix took it.
//
// Close the Arduino Serial Monitor while the website is connected:
// only one program can open the USB serial port at a time.
// ============================================================

#include <Arduino.h>
#include <FastLED.h>

#define DATA_PIN 14
#define POT_PIN A5 // Pin 19

constexpr int COLS = 8;
constexpr int ROWS = 32;
constexpr int NUM_LEDS = COLS * ROWS;

extern const uint8_t PIXEL_MASK[NUM_LEDS];
extern const uint8_t BASE_RGB[NUM_LEDS][3];

CRGB leds[NUM_LEDS];


// ------------------------------------------------------------
// Runtime flicker mask (editable from the LCD)
// ------------------------------------------------------------
//
// Starts as a copy of PIXEL_MASK from data.ino.
// 1 = flicker, 0 = constant.
//

uint8_t pixelMask[NUM_LEDS];


// ------------------------------------------------------------
// LCD link (ESP32-2432S028R "NO FOTO" app on Serial1)
// ------------------------------------------------------------
//
// Teensy pin 0 (RX1) <- LCD TX (IO1)
// Teensy pin 1 (TX1) -> LCD RX (IO3)
// GND shared.
//
// While the LCD controls the frequency the pot is ignored,
// until the pot is turned by more than POT_TAKEOVER counts.
//

constexpr unsigned long LCD_BAUD = 115200;
constexpr int POT_TAKEOVER = 40;
constexpr bool USE_POT = false;   // true = pot on A5 also sets the frequency

// Print the "bytes from LCD / measured flicker" line every 2 s.
// (The website hides this line from its log.)
constexpr bool STATUS_REPORT = true;

bool lcdControl = false;
int potAtLcd = 0;

char cmdBuf[NUM_LEDS + 8];
int cmdLen = 0;

uint8_t lcdRxBuffer[1024];

// Debug: bytes received from the LCD on Serial1
unsigned long lcdRxBytes = 0;


// ------------------------------------------------------------
// Overall brightness
// ------------------------------------------------------------
//
// The logical background can still be RGB 255,255,255,
// while this limits physical LED output.
//

constexpr uint8_t MASTER_BRIGHTNESS = 100;


// ------------------------------------------------------------
// Modulating (flicker) pixel brightness
// ------------------------------------------------------------
//
// Dims the flicker pixels' ON state: 100 % = full, 0 % = off.
// Set with D<0-100>.
//

int flickerPct = 100;
uint8_t flickerScale = 255;


// ------------------------------------------------------------
// Steady (continuous) pixel brightness
// ------------------------------------------------------------
//
// Scales only the pixels that do NOT flicker (mask = 0).
// 255 = full, 0 = off.
//
// AUTO-MATCH (default): steady pixels are set so they look as bright
// as the flicker pixels to the eye.
//
// Above the flicker-fusion rate the eye sees the TIME AVERAGE of a
// flickering light (Talbot-Plateau law). The flicker pixels are ON
// half the time and OFF half the time (50 % duty), so they look like
//
//     average = flicker brightness x duty
//             = flickerScale x 0.5
//
// so the steady pixels are set to that average:
//
//     steadyScale = flickerScale x 0.5 x MATCH_TRIM
//
//   D100 -> flicker 255, steady 128
//   D60  -> flicker 153, steady  77
//
// With the flicker off (F0) the flicker pixels stay ON (duty = 1),
// so steady = flickerScale.
//
// This works without gamma correction because both are LED PWM
// values: light output is linear in the PWM value, and the eye
// averages light, not PWM steps.
//
// MATCH_TRIM: fine-tune by eye if the letters are still faintly
// visible (> 1 makes the steady pixels brighter).
//
// B<pct> sets the steady pixels by hand and switches auto-match off;
// A switches it back on.
//

constexpr float FLICKER_DUTY = 0.5f;   // ON time / full period
constexpr float MATCH_TRIM = 1.0f;

bool autoMatch = true;
uint8_t steadyScale = 128;

// Set when the mask or brightness changes, so the panel is redrawn
// even while the flicker is off (F0).
bool needRender = false;

// Counts flicker toggles for the measured-frequency report.
unsigned long toggleCount = 0;


// ------------------------------------------------------------
// Davis test frequencies
// ------------------------------------------------------------
// I personally start to not recognize flickering at 50 Hz
const int TEST_FREQS[] = {
  20, 33, 42, 50, 56, 60, 63, 71, 83, 100, 120,
  250, 400, 500, 556, 625, 714, 833, 1000
};

constexpr int NUM_FREQS =
  sizeof(TEST_FREQS) / sizeof(TEST_FREQS[0]);


// ------------------------------------------------------------
// Timing
// ------------------------------------------------------------

unsigned long selectedInterval = 1000;

int selectedFreq = 500;

bool selectedState = true;

unsigned long previousSelectedTime = 0;


// ------------------------------------------------------------
// Matrix orientation
// ------------------------------------------------------------

constexpr bool SERPENTINE = true;
constexpr bool FLIP_X = true;
constexpr bool FLIP_Y = false;


// ============================================================
// XY ADDRESSING
// ============================================================

int XY(int x, int y) {

  if (FLIP_X) {
    x = COLS - 1 - x;
  }

  if (FLIP_Y) {
    y = ROWS - 1 - y;
  }

  if (
    SERPENTINE &&
    (y % 2 == 1)
  ) {

    return
      y * COLS +
      (COLS - 1 - x);
  }

  return
    y * COLS +
    x;
}


// ============================================================
// POTENTIOMETER
// ============================================================

// Recalculates the steady brightness from the flicker brightness.
void updateSteady() {

  if (!autoMatch) {
    return;
  }

  // Flicker off (F0): flicker pixels are always ON.
  float duty =
    (selectedFreq > 0) ? FLICKER_DUTY : 1.0f;

  float v =
    flickerScale * duty * MATCH_TRIM;

  if (v > 255.0f) {
    v = 255.0f;
  }

  steadyScale = (uint8_t)(v + 0.5f);
  needRender = true;
}


void applyFrequency(
  int freq
) {

  selectedFreq =
    freq;

  // 0 Hz = flicker off: flicker pixels stay lit.
  if (selectedFreq <= 0) {

    selectedFreq = 0;
    selectedInterval = 0;
    selectedState = true;
    needRender = true;

    updateSteady();

    return;
  }

  selectedInterval =
    1000000UL /
    (2UL * selectedFreq);

  updateSteady();
}


void readPot() {

  // With no potentiometer wired to A5 the pin floats and the
  // frequency jumps around. Set USE_POT true once a pot is wired.
  if (!USE_POT) {
    return;
  }

  int potValue =
    analogRead(POT_PIN);

  if (lcdControl) {

    if (
      abs(potValue - potAtLcd) >
      POT_TAKEOVER
    ) {

      lcdControl = false;

    } else {

      return;
    }
  }

  int freqIndex =
    (potValue * NUM_FREQS) / 1024;

  if (
    freqIndex >= NUM_FREQS
  ) {

    freqIndex =
      NUM_FREQS - 1;
  }

  applyFrequency(
    TEST_FREQS[freqIndex]
  );
}


// ============================================================
// LCD LINK (Serial1)
// ============================================================
//
// LCD -> Teensy (one command per line):
//
//   F<hz>        flicker frequency, 0 (off) to 2000
//   B<pct>       steady-pixel brightness, 0-100 % (turns auto-match off)
//   D<pct>       flicker-pixel brightness, 0-100 %
//   A            steady pixels auto-match the flicker pixels again
//   P<idx>,<0|1> set one pixel of the flicker mask
//   M<256 x 0|1> replace the whole mask
//   R            give frequency control back to the pot
//
// One-way link: the Teensy never sends anything back to the LCD,
// so the Teensy TX1 (pin 1) wire is not needed.
//

bool handleCommand(
  const char *s
) {

  bool ok = true;

  switch (s[0]) {

    case 'F': {

      // Any frequency from 0 (flicker off) to 2000 Hz.
      // The LCD slider sends steps of 10.
      int freq = atoi(s + 1);

      if (freq >= 0 && freq <= 2000) {

        applyFrequency(freq);

        lcdControl = true;

        potAtLcd =
          analogRead(POT_PIN);

        Serial.print("  -> F applied: ");
        Serial.print(freq);
        Serial.println(" Hz");

      } else {

        Serial.print("  -> F rejected, out of range 0-2000: ");
        Serial.println(freq);
        ok = false;
      }

      break;
    }

    case 'B': {

      // Steady-pixel brightness in percent, 0-100.
      int pct = atoi(s + 1);

      if (pct >= 0 && pct <= 100) {

        autoMatch = false;
        steadyScale = (uint8_t)((pct * 255 + 50) / 100);
        needRender = true;

        Serial.print("  -> B applied: steady brightness ");
        Serial.print(pct);
        Serial.println(" % (auto-match off, send A to turn it back on)");

      } else {

        Serial.println("  -> B rejected, need 0-100");
        ok = false;
      }

      break;
    }

    case 'P': {

      int idx, value;

      if (
        sscanf(s + 1, "%d,%d", &idx, &value) == 2 &&
        idx >= 0 && idx < NUM_LEDS &&
        (value == 0 || value == 1)
      ) {

        pixelMask[idx] = value;
        needRender = true;

        Serial.print("  -> P applied: pixel ");
        Serial.print(idx);
        Serial.print(" = ");
        Serial.println(value);

      } else {

        Serial.println("  -> P rejected (bad format or range)");
        ok = false;
      }

      break;
    }

    case 'M': {

      if (strlen(s + 1) != NUM_LEDS) {

        Serial.print("  -> M rejected: length ");
        Serial.print(strlen(s + 1));
        Serial.print(", need ");
        Serial.println(NUM_LEDS);

        ok = false;
        break;
      }

      for (
        int i = 0;
        i < NUM_LEDS;
        i++
      ) {

        char c = s[1 + i];

        if (c != '0' && c != '1') {

          Serial.print("  -> M rejected: bad character at ");
          Serial.println(i);

          return false;
        }
      }

      for (
        int i = 0;
        i < NUM_LEDS;
        i++
      ) {

        pixelMask[i] = s[1 + i] - '0';
      }

      needRender = true;

      {
        int flickering = 0;

        for (int i = 0; i < NUM_LEDS; i++) {
          flickering += pixelMask[i];
        }

        Serial.print("  -> M applied: ");
        Serial.print(flickering);
        Serial.println(" pixels flicker");
      }

      break;
    }

    case 'D': {

      // Flicker-pixel brightness in percent, 0-100.
      int pct = atoi(s + 1);

      if (s[1] != '\0' && pct >= 0 && pct <= 100) {

        flickerPct = pct;
        flickerScale = (uint8_t)((pct * 255 + 50) / 100);
        needRender = true;

        updateSteady();

        Serial.print("  -> D applied: flicker brightness ");
        Serial.print(pct);
        Serial.print(" % | steady ");
        Serial.print(steadyScale);
        Serial.println(autoMatch ? "/255 (auto-match)" : "/255 (manual)");

      } else {

        Serial.println("  -> D rejected, need 0-100");
        ok = false;
      }

      break;
    }

    case 'A':

      autoMatch = true;
      updateSteady();

      Serial.print("  -> A applied: auto-match on, steady ");
      Serial.print(steadyScale);
      Serial.println("/255");

      break;

    case 'C':

      for (int i = 0; i < NUM_LEDS; i++) {
        pixelMask[i] = 0;
      }

      needRender = true;

      Serial.println("  -> C applied: mask cleared");

      break;

    case 'R':

      lcdControl = false;

      break;

    default:

      ok = false;

      break;
  }

  return ok;
}


// Reads one line at a time from a port and runs it as a command.
// fromLcd = true counts the bytes for the debug report.
void pollCommands(
  Stream &port,
  char *buf,
  int bufSize,
  int &len,
  bool fromLcd
) {

  while (port.available()) {

    char c = port.read();

    if (fromLcd) {
      lcdRxBytes++;
    }

    if (c == '\n' || c == '\r') {

      if (len > 0) {

        buf[len] = '\0';

        Serial.print(fromLcd ? "LCD cmd: " : "USB cmd: ");

        if (len > 60) {

          Serial.print(String(buf).substring(0, 60));
          Serial.print("... (");
          Serial.print(len);
          Serial.println(" chars)");

        } else {

          Serial.println(buf);
        }

        bool ok = handleCommand(buf);

        // Acknowledge USB (website / Serial Monitor) commands.
        if (!fromLcd) {
          Serial.print(ok ? "OK " : "ERR ");
          Serial.println(buf[0]);
        }

        len = 0;
      }

    } else if (len < bufSize - 1) {

      buf[len++] = c;

    } else {

      len = 0;
    }
  }
}


char usbBuf[NUM_LEDS + 8];
int usbLen = 0;


void readLcd() {

  pollCommands(
    Serial1, cmdBuf, sizeof(cmdBuf), cmdLen, true
  );

  // Same commands typed into the Serial Monitor, for testing
  // the Teensy without the LCD.
  pollCommands(
    Serial, usbBuf, sizeof(usbBuf), usbLen, false
  );
}


// ============================================================
// CHECK MASK
// ============================================================

bool isSelectedPixel(
  int x,
  int y
) {

  int maskIndex =
    y * COLS + x;

  return
    pixelMask[maskIndex] == 1;
}


// ============================================================
// GET BACKGROUND COLOR
// ============================================================

CRGB getBackgroundColor(
  int logicalIndex
) {

  return CRGB(

    BASE_RGB
      [logicalIndex][0],

    BASE_RGB
      [logicalIndex][1],

    BASE_RGB
      [logicalIndex][2]
  );
}


// ============================================================
// RENDER
// ============================================================

void renderFrame() {

  for (
    int y = 0;
    y < ROWS;
    y++
  ) {

    for (
      int x = 0;
      x < COLS;
      x++
    ) {

      int logicalIndex =
        y * COLS + x;

      int ledIndex =
        XY(x, y);

      CRGB backgroundColor =
        getBackgroundColor(
          logicalIndex
        );


      // ------------------------------------------------------
      // SELECTED PIXEL
      //
      // Flickers:
      //
      // background color <-> black
      // ------------------------------------------------------

      if (
        isSelectedPixel(x, y)
      ) {

        if (
          selectedState
        ) {

          CRGB flickerColor =
            backgroundColor;

          flickerColor.nscale8_video(
            flickerScale
          );

          leds[ledIndex] =
            flickerColor;

        } else {

          leds[ledIndex] =
            CRGB::Black;
        }
      }


      // ------------------------------------------------------
      // NORMAL BACKGROUND PIXEL
      //
      // Does not flicker.
      // ------------------------------------------------------

      else {

        CRGB steadyColor =
          backgroundColor;

        steadyColor.nscale8_video(
          steadyScale
        );

        leds[ledIndex] =
          steadyColor;
      }
    }
  }

  FastLED.show();

  needRender = false;
}


// ============================================================
// SETUP
// ============================================================

void setup() {

  pinMode(
    DATA_PIN,
    OUTPUT
  );

  pinMode(
    POT_PIN,
    INPUT
  );

  Serial.begin(
    115200
  );

  // Larger receive buffer: refreshing 256 LEDs blocks loop() for ~8 ms,
  // which is more than the default 64 bytes can hold at 115200 baud.
  Serial1.addMemoryForRead(
    lcdRxBuffer,
    sizeof(lcdRxBuffer)
  );

  Serial1.begin(
    LCD_BAUD
  );

  for (
    int i = 0;
    i < NUM_LEDS;
    i++
  ) {

    pixelMask[i] =
      PIXEL_MASK[i];
  }

  updateSteady();

  delay(100);

  FastLED.addLeds<
    NEOPIXEL,
    DATA_PIN
  >(
    leds,
    NUM_LEDS
  );

  FastLED.setBrightness(
    MASTER_BRIGHTNESS
  );

  FastLED.clear(true);

  renderFrame();

  delay(500);
}


// ============================================================
// LOOP
// ============================================================

void loop() {

  readLcd();

  readPot();

  unsigned long now =
    micros();

  if (
    selectedFreq > 0 &&
    now -
    previousSelectedTime >=
    selectedInterval
  ) {

    previousSelectedTime =
      now;

    selectedState =
      !selectedState;

    toggleCount++;

    renderFrame();

  } else if (needRender) {

    // Flicker off (or between toggles): still show mask and
    // brightness changes right away.
    renderFrame();
  }


  // ----------------------------------------------------------
  // Serial status
  // ----------------------------------------------------------

  static unsigned long lastRxReport = 0;

  if (STATUS_REPORT && millis() - lastRxReport > 2000) {

    lastRxReport = millis();

    Serial.print("Serial1 bytes from LCD so far: ");
    Serial.print(lcdRxBytes);

    // Real flicker rate: one full on/off cycle = 2 toggles.
    // Each panel refresh takes ~8 ms, so this tops out around 60 Hz
    // no matter what frequency is requested.
    Serial.print(" | measured flicker: ");
    Serial.print(toggleCount / 4.0f);
    Serial.println(" Hz");

    toggleCount = 0;
  }

  static int previousFreq = -1;

  if (
    selectedFreq !=
    previousFreq
  ) {

    previousFreq =
      selectedFreq;

    Serial.print(
      "Requested frequency: "
    );

    Serial.print(
      selectedFreq
    );

    Serial.print(
      " Hz | toggle interval: "
    );

    Serial.print(
      selectedInterval
    );

    Serial.println(
      " us"
    );
  }
}
