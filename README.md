# GOTHIC — a browser homage, from scratch

A small playable recreation of the opening of *Gothic* (Piranha Bytes, 2001), running
entirely in the browser. No engine, no libraries, no build step — a hand-written WebGL2
renderer and game in plain JavaScript.

![screenshot](screenshot.png)

## Run it

Open `index.html` in any modern browser (Chrome, Edge, Firefox). That's it — it works
straight from the file system, no server needed.

Useful URL parameters:

- `index.html?demo` — skips the title screen (used for screenshots/testing)
- `index.html?demo&time=0.97` — also forces the time of day (0..1, 0.5 = noon)
- `index.html?autotest` — runs the automated gameplay smoke test and prints PASS/FAIL

## What's in the Colony

- **The valley** — procedural terrain ringed by snow-capped mountains, with the
  shimmering magic **Barrier** dome closing it off (it physically throws you back).
- **The Old Camp** — palisade ring with a south gate, diggers' huts, the ore barons'
  castle keep, campfires that act as real light sources at night.
- **People** — Diego at the gate (quest giver), gate guards, Whistler the trader,
  Snaf the cook, wandering diggers — each with dialogue.
- **A quest** — clear five molerats from the old mine path for 50 ore and a blade.
- **Combat** — melee swings with timing, aggro/chase/leash AI, XP and level-ups.
- **Hostiles** — molerats on the mine path, bandits at the ruined watchtower (NE),
  wolves around the ore vein (NW), and **shadowbeasts** at the rich vein by the old
  mine — without the Ore blade and level 5 they will simply kill you.
- **Gathering** — **every tree and every rock in the valley is harvestable**: a
  woodcutter's axe fells trees, a pickaxe breaks rocks and the two glowing ore
  veins (the lesser one in wolf country, the rich one — double yield — in
  shadowbeast country). Everything regrows/respawns after a while.
- **An economy** — sell wood/stone/raw ore to Whistler. His stock is capped; his
  smelter slowly burns it down into nuggets (two goods in, one good's worth of ore
  out — lossy on purpose, so ore never floods the valley) which frees room to buy
  more. He also restocks dried meat and health potions over time.
- **Equipment** — weapons live in the inventory and are equipped from there (Old
  Camp blade → Soldier's sword → Ore blade), plus an offhand **torch** that casts
  real light at night.
- **Systems** — inventory with food healing, ore currency, trading, journal,
  day/night cycle with sun, moon, stars and fog, a lake, death & respawn.

## Controls

Desktop:

| Key | Action |
|---|---|
| WASD | Move (Shift to walk) |
| Mouse | Look (click to capture the cursor) |
| Left click | Attack |
| Space | Jump |
| E | Talk |
| I | Inventory (eat, drink, equip weapons, light the torch) |
| J | Journal |
| C | Character screen |
| Enter | Chat (multiplayer) |
| G | Challenge the player next to you to a duel (multiplayer) |
| Y / N | Accept / decline a duel challenge |
| Esc | Close panel / release cursor |

Mobile (auto-detected when the primary pointer is touch; force with `?touch`):

![mobile screenshot](screenshot-mobile.png)

- Left thumb stick: move (analog — push gently to walk)
- Drag anywhere on the world: look around
- ⚔ attack · ▲ jump (hold) · I inventory · J journal · C character · 💬 chat
- Tap the on-screen prompt to talk, accept a duel, or challenge a nearby player

## Multiplayer

![multiplayer](screenshot-mp.png)

One server, n players, one persistent world. The title screen lets every player
choose **Single Player** (their own local Colony) or **Multiplayer** (the shared
world). The static game stays on Netlify (or any static host); `server.js` runs
separately — it's a zero-dependency Node script (the WebSocket protocol is
implemented by hand, no npm install needed).

Players carry their **level above their head**, next to their name. The server
owns world time (saved to `world.json`, so it survives restarts) and all hostile
NPCs: their AI, deaths and **respawns** (molerats 60s, wolves 90s, bandits 120s,
shadowbeasts 180s). Hits are validated server-side. Players cannot kill each other and camp folk
can never be killed — the one sanctioned exception is the **duel**: stand next to
another player, press G, and if they accept (Y) you fight until one of you is
beaten to the yield point (10 HP — never death). The loser forfeits **half their
ore** to the winner. The intended loop: the winner buys potions and keeps
fighting; the loser picks up an axe or pickaxe and goes gathering to rebuild the
purse. There is also a world **chat** (Enter). Player progress (level, ore, items,
quest) is saved per browser in localStorage; add `?reset` to the URL to start over.

Run it:

```
node server.js          # listens on $PORT or 8080
```

Free hosts (like Render's free tier) wipe the disk on every deploy and restart, so
`world.json` alone would forget the day count. Set two environment variables and
the server backs the world up to a GitHub **Gist** (and restores from it on boot):

1. Create a gist at gist.github.com containing a file named `world.json` (content
   `{}` is fine) and note its ID (the hash in the URL).
2. Create a token at github.com/settings/tokens with only the **gist** scope.
3. On the host set `GIST_ID` and `GITHUB_TOKEN`. Backups happen at most once per
   in-game day (~every 8 minutes), so the gist history stays small.

Which server the Multiplayer button joins (first match wins):

1. `?server=wss://...` URL parameter (remembered in the browser afterwards)
2. `DEFAULT_SERVER` at the top of `js/net.js` (currently the Render deployment)
3. `ws://localhost:8080` as a dev fallback on file:// or localhost

If the server doesn't answer, the game keeps running single-player and retries in
the background (hostiles respawn in single player too).

Hosting the server for free: create a GitHub repo containing `server.js`, then on
[render.com](https://render.com) make a **Web Service** from it — runtime Node,
start command `node server.js`. Render sets `$PORT` automatically and gives you
`wss://your-name.onrender.com`. (Free instances sleep when idle; the first visitor
wakes them in ~30 s.) Any always-on box with Node works the same.

`tools/bot.js` is a headless test player: `node tools/bot.js localhost 8080 Gorn`.
`tools/dueltest.js` runs a scripted two-player duel + chat against a server and
prints PASS/FAIL: `node tools/dueltest.js localhost 8080`.

## How it's built

| File | Role |
|---|---|
| `js/math3d.js` | Column-major mat4/vec3 math, seeded PRNG |
| `js/engine.js` | WebGL2 setup, GLSL shaders (lit/sky/water/barrier/flames), mesh builders |
| `js/world.js` | Terrain function + colors, Old Camp, forest, lake, mine, ruin, colliders |
| `js/character.js` | Articulated humans & molerats posed from a single unit cube |
| `js/game.js` | Player physics, NPC AI, combat, quests, items, dialogue trees |
| `js/ui.js` | HUD, dialogue box, inventory, journal, death screen |
| `js/main.js` | Input, third-person camera, day/night lighting, render loop |
| `js/touch.js` | Mobile controls: virtual joystick, drag-to-look, action buttons |
| `js/net.js` | Multiplayer client: remote players, server-driven hostiles, saves |
| `server.js` | World server: hand-rolled WebSockets, hostile AI, duels, chat, gist backup |
| `tools/bot.js` | Headless test player for the server |
| `tools/dueltest.js` | Scripted two-player duel + chat protocol test |
| `js/test.js` | In-page gameplay smoke test (`?autotest`) |

Everything is flat-shaded low-poly geometry generated at load time; characters are
hierarchies of tinted unit cubes; the palisade ring collides analytically. All
content is original work inspired by the setting — no assets or code from the game.
