# Flicker Matrix: Web Input

A website where visitors type a word (up to 5 letters) or draw on a 32×8 preview. Black pixels are the ones that **flicker** on the LED matrix. When they press **Send**, the drawing goes to the Teensy over USB serial.

```
visitor's phone ──► Render server (server.js) ──SSE──► same website in Chrome on the laptop ──Web Serial (USB)──► Teensy
                                                                                                                  ▲
                                                                                              CYD LCD ── Serial1 ─┘
```

Render can't reach a USB port, so the laptop the Teensy is plugged into keeps the website open in Chrome and clicks **connect teensy** (bottom of the page, desktop Chrome/Edge only). That tab then listens to the server and writes each submission to the Teensy with the browser's Web Serial API. Nothing needs installing.

## 1. Teensy

Upload [`arduino/flicker_teensy_1x8x32_web`](../arduino/flicker_teensy_1x8x32_web) (the same as `flicker_teensy_1x8x32_0910`, plus USB acknowledgements and a `C` clear command). The CYD LCD input still works.

Each submission arrives as one line: `M` + 256 × `0/1` + newline.

## 2. Deploy the server on Render

The server has no dependencies (Node 18+).

- **Blueprint:** push the repo, then in Render choose *New → Blueprint*, pick this repo and set **Blueprint Path** to `web/render.yaml`. It sets `rootDir: web`.
- **Or manually:** *New → Web Service*, Root Directory `web`, Build Command `echo ok`, Start Command `node server.js`, No environment variables are needed.

Optional env vars:

| Var | Default | What it does |
|---|---|---|
| `BRIDGE_TOKEN` | (none) | Optional password so only your laptop can receive drawings. If set, the page asks for it once when you click **connect teensy**. |
| `COOLDOWN_SECONDS` | `3` | How long each visitor waits between sends |
| `MIRROR` | `0` | Set `1` if the word appears mirrored left↔right on the matrix |
| `FLIP` | `0` | Set `1` if it appears upside down |

## 3. Connect the Teensy from the laptop

1. Plug in the Teensy and close the Arduino Serial Monitor, because only one program can open the port at a time.
2. In **Chrome or Edge** (Safari and Firefox have no Web Serial), open `https://YOUR-APP.onrender.com` and click **connect teensy** at the bottom.
3. Pick the Teensy (it shows as a USB serial device).

After the first time, the page reconnects to the server and the Teensy on its own when you reload it or plug the cable back in.

Phones never see the connect link.
The link's status shows `teensy connected · receiving · last: WORD`. The Teensy's `OK`/`ERR` replies appear in the browser console.

Visitors see **matrix online** in the footer while the laptop is connected.

Keep the tab open, and stop the laptop from sleeping (System Settings → Lock Screen / Energy). The free Render plan sleeps after about 15 minutes with no traffic. The page's open connection usually keeps it awake. If the server does go to sleep, the page reconnects once the server is back up.

## Local test

```bash
cd web && node server.js      # then open http://localhost:3000 in Chrome
```

## Orientation

The preview is landscape: 32 wide × 8 tall. The server converts it to the Teensy mask order used in `data.ino`: preview x → mask row, preview y → 7 − mask column. This was checked against the "KEZIA" mask in `data.ino`.
