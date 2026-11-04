/*
  ============================================================
  CAMERA ALIASING / FLICKER TEST — 8x32 WS2812B LED MATRIX
  ============================================================

  Hardware:
  - Teensy 4.0
  - 8x32 WS2812B LED matrix (256 LEDs)
  - LED data connected to pin 11
  - Potentiometer connected to A5
      outer pin  -> 3.3V
      middle pin -> A5
      outer pin  -> GND

  PURPOSE
  ------------------------------------------------------------
  This sketch explores differences between human perception
  and camera perception of a rapidly flickering LED matrix.

  The matrix displays "HELLO" using one temporal modulation
  frequency while the surrounding background pixels flicker
  at a slightly different frequency.

  The potentiometer selects between a set of flicker
  frequencies used in Davis et al.'s flicker-perception
  experiment:

  20, 33, 42, 50, 56, 63, 71, 83, 100,
  250, 400, 500, 556, 625, 714, 833, 1000 Hz

  POTENTIOMETER
  ------------------------------------------------------------
  Turning the potentiometer snaps the HELLO pixels between
  the frequencies listed above.

  The background uses the same calculated interval plus
  a fixed offset of 100 microseconds:

      BG interval = HELLO interval + 100 us

  FREQUENCY CALCULATION
  ------------------------------------------------------------
  A complete flicker cycle consists of:

      ON -> OFF -> ON

  For a 50% duty cycle:

      full period T = 1 / frequency
      toggle interval = T / 2

  In microseconds:

      interval_us = 1,000,000 / (2 * frequency)

  Example for 500 Hz:

      T = 1 / 500
        = 0.002 s
        = 2 ms

      ON  = 1 ms
      OFF = 1 ms

      HELLO_INTERVAL = 1000 us

      With the +100 us background offset:

      HELLO = 1000 us -> theoretical 500 Hz
      BG    = 1100 us -> theoretical 454.5 Hz

  IMPORTANT HARDWARE LIMITATION
  ------------------------------------------------------------
  WS2812B LEDs use an approximately 800 kbit/s serial data
  protocol.

  Updating all 256 pixels requires approximately:

      256 LEDs * 24 bits / 800,000 bits/s
      = 7.68 ms per FastLED.show()

  Therefore, high requested frequencies such as 500 Hz or
  1000 Hz cannot actually be reproduced as full-matrix
  updates at those frequencies with this implementation.

  The selected frequencies and calculated intervals should
  therefore be considered REQUESTED / THEORETICAL timing,
  rather than measured physical LED modulation frequencies.

  Draw the selected pixel to be flickered on this p5js sketch
  and copy the Arduino array:
  https://editor.p5js.org/e.kezia/sketches/7CH2C061F
  ============================================================
*/