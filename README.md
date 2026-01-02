# Hidden Watermark LED Art

## Overview

This project explores the intersection of technology, perception, and contemporary art-viewing behavior. Inspired by how audiences often experience art through their mobile device cameras, this work leverages the aliasing effect of digital cameras to embed hidden messages or watermarks in an LED artwork—visible only when viewed through a camera.

Depending on the configuration, the artwork can:

- Display one image to the naked eye and a different, hidden pattern (such as a watermark or text) through a camera.
- Obscure or alter faces when photographed, or reveal a copyright watermark, prompting viewers to credit the artist when sharing images.

## Concept

By exploiting the difference between human and camera perception—specifically, the camera’s shutter speed and frame rate—this project flickers certain pixels (the `FLICKERED_PIXELS`) at high speed. These pixels can be toggled to encode different watermarks or patterns, which are only visible in photos or videos due to aliasing.

The project is a playful critique of art consumption in the digital age, where the act of photographing art can change the experience and even the artwork itself.

## Technology

- **p5.js**: Handles face detection (using ml5’s FaceMesh) and serial communication to the microcontroller.
- **Arduino (Teensy 4.0)**: Controls three separate 8x24 NeoPixel LED strips, rapidly flickering selected pixels to create the hidden watermark effect.
- **Materials**: NeoPixel strips, Teensy 4.0, resistors, capacitors, 5V power supply, matte and frosted acrylic, cardboard.

## How It Works

1. **Face Detection & Pattern Generation**:  
   The p5.js script uses FaceMesh to detect faces or generate patterns, then sends pixel data to the Teensy via serial communication.

2. **LED Control & Watermark Flicker**:  
   The Teensy receives pixel data and updates the NeoPixel strips. Specific pixels (the `FLICKERED_PIXELS`) are rapidly toggled to encode a watermark or pattern. By commenting/uncommenting different `FLICKERED_PIXELS` definitions in the Arduino code, you can change the watermark.

3. **Camera Aliasing**:  
   The rapid flicker is imperceptible to the human eye but creates visible patterns when captured by a camera, revealing the hidden message.

## Setup & Usage

### Hardware

- 3 × 8x24 NeoPixel strips (not daisy-chained; each on a separate digital pin)
- Teensy 4.0 microcontroller
- 3 × 470Ω resistors (one per strip)
- 1000μF capacitor
- 5V power supply
- Matte and frosted acrylic, cardboard for housing

### Software

- Upload the Arduino code (`teensy-with-watermark.ino`) to the Teensy 4.0.
- Run the p5.js sketch (`p5js/sketch.js`) in a browser (served via localhost or similar).
- Connect the Teensy to your computer via USB for serial communication.

### Customizing the Watermark

- In the Arduino code, locate the `FLICKERED_PIXELS` section.
- Comment/uncomment different pixel definitions to change the watermark or hidden pattern.

## Variations

- **Face Filter + Watermark**: Mocks the act of taking selfies with art by overlaying a watermark or blocking faces in photos.
- **Aliasing Patterns**: Uses camera artifacts to create meta-commentary on digital reproduction.
- **Copyright/AI-Generated Images**: Explores copyright issues by embedding watermarks in AI-generated or stock images.

## Credits

Special thanks to Daniel Rozin, Sophie, Octavio, Christina, Billy Fadhila, Fabrizio, Cody Frost, and all friends for their support and feedback.
