# NFS Underground 2 — Save Editor (Web)

Browser-based utility for editing **Need for Speed: Underground 2** career save files & extended `GARAGE.DAT` files. All file parsing and modifications happen locally in your browser - saves are never uploaded to any server.

## About This Fork
This is a fork of [Starladdey/nfsu2-save-editor](https://github.com/Starladdey/nfsu2-save-editor), the editor behind [nfsu2.divon.eu](https://nfsu2.divon.eu/). It adds the v3.0 changes listed under [What's New in v3.0](#whats-new-in-v30): one-button *Unlock Everything*, visual customisation, Quick Race custom cars, a built-in parts list and a number of save-safety fixes.

The original repository ships its app only as a minified bundle, so the new features live in separate, readable modules (`js/visual-editor.js`, `js/career.js`, `js/custom-cars.js` and their data files) with small, documented patches to `js/app.bundle.min.js`. I plan to contact the original author to offer these changes for merging upstream and to ask about the unminified source, so they can be folded into it properly. Until then, the live site above runs the original version.

## Web Version
- **Live Editor:** [nfsu2.divon.eu](https://nfsu2.divon.eu/)
- **Guides & Documentation:** [nfsu2.divon.eu/guides/](https://nfsu2.divon.eu/guides/)

![NFS Underground 2 Save Editor preview](assets/web.png)

## What's New in v3.0

**New**
- **Unlock Everything** — one button for a fully unlocked game: 100% career from the game's own goals, every shop part and Car Lot car, all garage slots, and every part owned on every garage car so nothing is padlocked in *My Garage*. No game files needed.
- **Visual customisation** for every garage and custom car: body kits, spoilers, rims (by brand, model and size), paint, vinyls (by category), decals, tint, neons, specialties and gauges, with *Reset to stock* per section, per tab or for the whole car.
- **Quick Race custom cars** can be added, changed, tuned and deleted like garage cars.
- **Built-in parts list**, so the Visuals menus work without the game's `GLOBALB.BUN` (your own file can still be loaded for modded games).
- **Real career figures** in the overview (completion %, stage, events, shops, Car Lot) instead of estimates.

**Fixed**
- The old *100% Sandbox* copied the bundled demo save (`JANE`) over yours, including its races, messages and custom cars. It is replaced by *Unlock Everything*.
- Unlocking slots, injecting cars and *Enable All 5 Slots* raised the **career stage** (offset `0xA175`), skipping stages and stranding their races; the stage is no longer touched by slot edits.
- The stage display read bytes from garage slot 4 instead of the real career stage.
- Unlocking a slot copied slot 1's window tint, neons, bulbs and hydraulics into it and wrote invalid neon/bulb values; injected presets kept the previous car's vinyls, decals and neons. Stock values are used instead.
- Cars without tint/neon data were shown as *Locked*.
- Choosing a performance tier also overwrote 420 bytes of the car's purchased parts and an unverified table at `0xC45B`; it now sets only the performance parts.
- Edited nfsu2-web backups lost slots 6–10: the `GARAGE.DAT` fingerprint is now updated with your edits.
- *My Garage* kept **Rims** padlocked when a car owned rims at the start of the game's list, because of a bug in the game itself (`SPEED2.EXE` 0x539C20 tests only the first word of the owned-rims set); owned rims now avoid that range.
- After an update the page could run old cached scripts with new ones; the offline cache is now network-first and every script is versioned.

## Features (v3.0)
- **Profile, Cash & Native `.ZIP` Support:**
  - Rename your career profile (up to 7 ASCII characters) and edit your bank balance.
  - Direct support for exported `.zip` save archives (switch between multiple profiles inside the archive and download a ready-to-restore `.zip`). The GARAGE.DAT fingerprint is updated with your edits, so nfsu2-web keeps slots 6–10.
- **Career Garage (Slots 1–5) & GARAGE.DAT (Slots 6–10):**
  - Unlock all 5 career garage slots at any point in the game without changing your career stage or active map races.
  - Full support for external `GARAGE.DAT` files (Slots 6–10 used by `nfsu2.xyz` and Extra Options).
- **Performance, Outrun Uniques & Dyno:**
  - Switch any car between *Stock*, *Street (Lvl 1)*, *Pro (Lvl 2)*, and *Extreme (Lvl 3)* tuning levels.
  - Toggle all **9 Outrun Unique upgrades** (*Weight, Trans, NOS, Engine, Turbo, Susp, Brakes, ECU, Tires*) individually per car.
  - Apply quick **Dyno ECU/Turbo presets** (*Peak Horsepower*, *Drag Acceleration*, *Drift Torque*, or *Reset to Stock*).
- **40+ Built-in Car Presets:**
  - Story & Sponsor vehicles (*Rachel's 350Z*, *Caleb's GTO*, *Nikki's Mustang*, *Snoop Dogg's Escalade*, *Capone's H2*).
  - Custom Rivals, Player Builds, EU/US regional exclusives (*Peugeot 106*, *Opel Corsa*, *Honda Civic Si*, *Acura RSX*), and all 26 stock career cars.
- **Unlock Everything (one button):**
  - Completes the career from the game's own goals (all 224 events, 30 photo goals, every stage), so the game itself shows 100%; every shop, shop part and Car Lot car is unlocked and every garage slot (1–10) is open.
  - Every car in your garage owns every part (rims, spoilers, body kits, vinyls, decals, specialties, performance parts) and all 9 Outrun Uniques, so nothing is padlocked when you customise in the game's garage.
  - Keeps your profile name, money and cars. Works without any game files.
- **Visual Customisation (per car, optional):**
  - Change body kits, spoilers, hoods, rims, spinners, paint (body, rims, calipers, spoiler…), vinyls, decals, window tint, neons, hydraulics and custom gauges for any garage or custom car, with *Reset to stock* per section or for the whole car, and the game's own *None* where it has one.
  - Works without any game files: a built-in parts list (`js/parts-data.js`: part IDs, names and which cars they fit, no models or textures) offers only parts that fit the selected car; rims are listed by brand as model and size, vinyls by category. For a modded game you can load your own `GLOBAL\GlobalB.lzc` instead (read locally, never uploaded).
- **Quick Race Custom Cars:**
  - Add, change and delete the cars of *Quick Race → Customize* (up to 20, stored separately from the career garage): copy one of your garage cars or pick any built-in car, set the performance level, Outrun Uniques and Dyno curves, and edit visuals, like a garage car. New cars get the game's own `TUNED_CAR_<n>` IDs.
- **JSON Car Patches & Checksums:**
  - Export and import individual car builds as `.json` files.
  - Automatic header CRC-32 recalculation on save download.

## Backup Note
Always keep a backup of your original save files before editing (you can also enable the **Auto `.bak`** checkbox in the top bar).

## Guides
- [NFSU2 Save File Location (Windows 10/11 & Web Port)](https://nfsu2.divon.eu/guides/nfsu2-save-file-location/)
- [How to Get Rachel's 350Z & Boss Cars in Career Mode](https://nfsu2.divon.eu/guides/rachel-350z-nfsu2/)
- [Outrun Unique Parts & Stage 3 Performance Guide](https://nfsu2.divon.eu/guides/nfsu2-outrun-unique-parts/)
- [5–10 Slot Garage & GARAGE.DAT Editor Guide](https://nfsu2.divon.eu/guides/nfsu2-garage-dat-editor/)
- [NFSU2 Online Money Trainer Guide](https://nfsu2.divon.eu/guides/nfsu2-money-trainer/)
- [NFS Underground 2 PC Cheat Codes](https://nfsu2.divon.eu/guides/nfsu2-cheat-codes-pc/)

## Save File Location (Windows)
Press `Win + R` and paste:
`%LOCALAPPDATA%\NFS Underground 2`
*(See the [Save File Location Guide](https://nfsu2.divon.eu/guides/nfsu2-save-file-location/) for `nfsu2.xyz` `.zip` export and restore steps).*

## Running Locally
1. **Web App (PWA):** Open [nfsu2.divon.eu](https://nfsu2.divon.eu/) and install it via your browser's address bar for offline access.
2. **From Archive / Repository:**
   - Download the latest `.zip` from [Releases](https://github.com/Starladdey/nfsu2-save-editor/releases) or clone this repository.
   - Open `index.html` in your browser to load and edit local save files.
   - *Tests:* `node --test tests/*.test.mjs` (no dependencies). Career tests also need the game data: `NFSU2_GAMEDATA=/path/to/GLOBAL/GlobalB.lzc node --test tests/*.test.mjs`.
   - *Built-in game tables:* `js/parts-data.js` is generated with `node tools/build-parts-data.mjs /path/to/GLOBAL/GlobalB.lzc`.
   - *Note:* To use the `Try Demo` button locally, run a local HTTP server in the project folder (for example, `npx serve` or `python -m http.server 8000`), as browsers block `fetch()` requests over `file://`.

## Deploying
The site is plain static files with no build step. `wrangler.jsonc` publishes it as a Cloudflare Workers static site (`npx wrangler deploy`, or connect the repository in the Cloudflare dashboard with an empty build command); `.assetsignore` keeps `tests/`, `tools/` and this README off the site. Any static host works the same way.

## Credits & Disclaimer
- [NFSU2 Save File Technical Documentation](https://github.com/hackch/NFSU2-Savegame-Editor/blob/main/technical.md)
  - Technical research on save file structure and decryption.
- [hackch/NFSU2-Savegame-Editor](https://github.com/hackch/NFSU2-Savegame-Editor) (MIT, © 2025 Christopher Hack)
  - The `GLOBALB.BUN` part-database reader and visual-slot rules in `js/visual-editor.js`, and the career completion in `js/career.js`, are adapted from this project.
- Special thanks to players on r/NFSU2 for testing and feedback.

Unofficial non-commercial fan project. Not affiliated with, endorsed, or sponsored by Electronic Arts Inc. (EA).