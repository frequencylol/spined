// language: Node.js CJS, file: server.js — spined.lol v4.0
// target: Windows 11, Node.js 18+  |  created by 0847x
'use strict';

const express   = require('express');
const http      = require('http');
const { WebSocketServer } = require('ws');
const axios     = require('axios');
const archiver  = require('archiver');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs  = require('fs');
const fsp = fs.promises;
const path = require('path');

// ─── config ───────────────────────────────────────────────────────────────
const PORT      = 3001;
const ROOT      = __dirname;
const TOOLS_DIR = path.join(ROOT, 'tools');
const DL_DIR    = path.join(ROOT, 'downloads');
const ZIP_DIR   = path.join(DL_DIR, 'zips');
const LIB_FILE  = path.join(ROOT, 'library.json');
const REPO      = 'steamtools-games/ManifestHub3';

// Redistributable / runtime depots — never pick as main game content
const SKIP_DEPOTS = new Set([
  228987, 228988, 228989, 229000,
  1095511,
  1273350, 1628350, 1391110, 1493710,
  1580130, 2180100,
]);

// ─── GAME PROFILES ────────────────────────────────────────────────────────
// Per-game patching overrides. preferExe wins over auto-detection.
// skipExes are added to the SKIP_EXE regex blacklist at runtime.
// extraCopy: additional files to place in gameDir after Goldberg.
// readme: appended to the auto-generated HOW_TO_PLAY.txt in the zip.
const GAME_PROFILES = {
  // ── Brotato ──────────────────────────────────────────────────────────────
  1942280: {
    name      : 'Brotato',
    preferExe : 'Brotato.exe',
    arch      : 'x64',
    notes     : 'Godot engine — no DRM strip needed, Goldberg-only patch',
  },
  // ── A Short Hike ─────────────────────────────────────────────────────────
  1055540: {
    name      : 'A Short Hike',
    preferExe : 'A Short Hike.exe',
    arch      : 'x64',
    notes     : 'Unity x64 — Steamless strips SteamStub; run directly',
  },
  // ── DOOM (2016) ───────────────────────────────────────────────────────────
  379720: {
    name      : 'DOOM',
    preferExe : 'DOOMx64.exe',
    skipExes  : ['DOOMx64vk.exe'],          // Vulkan variant optional
    arch      : 'x64',
    notes     : 'id Tech 6 — DRM strip required; use DOOMx64.exe not launcher',
  },
  // ── DOOM Eternal ──────────────────────────────────────────────────────────
  782330: {
    name      : 'DOOM Eternal',
    preferExe : 'DOOMEternalx64vk.exe',
    arch      : 'x64',
    notes     : 'id Tech 7 — Denuvo stub; Steamless v3.1 handles Variant 3.1 x64',
  },
  // ── GTA V ─────────────────────────────────────────────────────────────────
  271590: {
    name      : 'Grand Theft Auto V',
    preferExe : 'GTA5.exe',
    skipExes  : ['GTAVLauncher.exe', 'PlayGTAV.exe', 'SocialClubHelper.exe'],
    arch      : 'x64',
    notes     : 'GTA5 — skip launcher; run GTA5.exe directly. Social Club bypass via Goldberg.',
    extraCopy : [
      // steam_interfaces.txt — tells Goldberg which Steam interfaces GTA5 needs
      { src: 'steam_interfaces.txt', dst: 'steam_interfaces.txt', optional: true },
    ],
  },
  // ── Hollow Knight ─────────────────────────────────────────────────────────
  367520: {
    name      : 'Hollow Knight',
    preferExe : 'hollow_knight.exe',
    arch      : 'x86',
    notes     : 'Unity x86 — confirm Steamless strips ok; some builds need -nographics workaround',
  },
  // ── Stardew Valley ────────────────────────────────────────────────────────
  413150: {
    name      : 'Stardew Valley',
    preferExe : 'Stardew Valley.exe',
    arch      : 'x64',
    notes     : 'MonoGame — no DRM, Goldberg-only. StardewModdingAPI.exe is the modded launcher.',
  },
  // ── Terraria ──────────────────────────────────────────────────────────────
  105600: {
    name      : 'Terraria',
    preferExe : 'Terraria.exe',
    arch      : 'x86',
    notes     : 'XNA / .NET — x86; Goldberg-only patch, no Steamless needed',
  },
  // ── Elden Ring ────────────────────────────────────────────────────────────
  1245620: {
    name      : 'ELDEN RING',
    preferExe : 'eldenring.exe',
    skipExes  : ['start_protected_game.exe'],
    arch      : 'x64',
    notes     : 'FromSoft — Steamless strips stub from eldenring.exe; skip EAC launcher',
  },
  // ── Cyberpunk 2077 ────────────────────────────────────────────────────────
  1091500: {
    name      : 'Cyberpunk 2077',
    preferExe : 'Cyberpunk2077.exe',
    skipExes  : ['REDprelauncher.exe', 'CrashReporter.exe'],
    arch      : 'x64',
    notes     : 'REDengine 4 — no Denuvo since 2.0 patch; Goldberg-only now',
  },
  // ── Stick Fight ───────────────────────────────────────────────────────────
  674940: {
    name      : 'Stick Fight: The Game',
    preferExe : 'StickFight.exe',
    arch      : 'x64',
    notes     : 'Unity x64 — small build; Goldberg-only, no DRM strip needed',
  },
  // ── RimWorld ──────────────────────────────────────────────────────────────
  294100: {
    name      : 'RimWorld',
    preferExe : 'RimWorldWin64.exe',
    arch      : 'x64',
    notes     : 'Unity x64 — Goldberg-only; RimWorldWin.exe is x86 fallback',
  },
  // ── Fallout 4 ─────────────────────────────────────────────────────────────
  377160: {
    name      : 'Fallout 4',
    preferExe : 'Fallout4.exe',
    skipExes  : ['Fallout4Launcher.exe', 'F4SE_loader.exe'],
    arch      : 'x64',
    notes     : 'Creation Engine — Steamless handles stub; skip launcher',
  },
  // ── Skyrim SE ─────────────────────────────────────────────────────────────
  489830: {
    name      : 'The Elder Scrolls V: Skyrim Special Edition',
    preferExe : 'SkyrimSE.exe',
    skipExes  : ['SkyrimSELauncher.exe', 'skse64_loader.exe'],
    arch      : 'x64',
    notes     : 'Creation Engine — same as Fallout 4 strip path',
  },
  // ── The Binding of Isaac: Rebirth ─────────────────────────────────────────
  250900: {
    name      : 'The Binding of Isaac: Rebirth',
    preferExe : 'isaac-ng.exe',
    arch      : 'x64',
    notes     : 'Custom engine — Goldberg-only patch',
  },
  // ── Dead Cells ────────────────────────────────────────────────────────────
  588650: {
    name      : 'Dead Cells',
    preferExe : 'deadcells.exe',
    arch      : 'x64',
    notes     : 'HashLink VM — Goldberg-only; no DRM in .exe',
  },
  // ── Hades ─────────────────────────────────────────────────────────────────
  1145360: {
    name      : 'Hades',
    preferExe : 'Hades.exe',
    arch      : 'x64',
    notes     : 'Supergiant custom engine — Goldberg-only patch',
  },
};

// ─── dirs ─────────────────────────────────────────────────────────────────
for (const d of [DL_DIR, ZIP_DIR, TOOLS_DIR]) fs.mkdirSync(d, { recursive: true });

// ─── library ──────────────────────────────────────────────────────────────
function loadLib()    { try { return JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')); } catch { return []; } }
function saveLib(lib) { fs.writeFileSync(LIB_FILE, JSON.stringify(lib, null, 2)); }
function upsertLib(entry) {
  const lib = loadLib();
  const idx = lib.findIndex(e => e.appid === entry.appid);
  if (idx >= 0) lib[idx] = { ...lib[idx], ...entry };
  else lib.push(entry);
  saveLib(lib);
}

// ─── express + ws ─────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

let activeJob = null;

const broadcast = (type, payload = {}) => {
  const msg = JSON.stringify({ type, ...payload });
  wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
};

const log = (text, level = 'info') => {
  process.stdout.write(`[${level}] ${text}\n`);
  if (level !== 'info') broadcast('log', { text, level });
};

const setProgress = (value, phase = '') => {
  if (activeJob) { activeJob.pct = value; activeJob.phase = phase; }
  broadcast('progress', { value, phase });
};

// ─── tools ────────────────────────────────────────────────────────────────
const findTool   = name => { const p = path.join(TOOLS_DIR, name); return fs.existsSync(p) ? p : null; };
const toolStatus = ()   => ({
  depotDownloader : !!findTool('DepotDownloaderMod.exe'),
  steamless       : !!findTool('Steamless.exe') || !!findTool('Steamless.CLI.exe'),
  steamApi        : !!findTool('steam_api.dll') || !!findTool('steam_api64.dll'),
});

// ─── ManifestHub3 ─────────────────────────────────────────────────────────
const fetchHub = async (appId, file) => {
  const urls = [
    `https://raw.githubusercontent.com/${REPO}/${appId}/${file}`,
    `https://cdn.jsdelivr.net/gh/${REPO}@${appId}/${file}`,
  ];
  for (const url of urls) {
    try {
      const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
      if (r.status === 200 && r.data.byteLength > 20) return Buffer.from(r.data);
    } catch {}
  }
  return null;
};

const parseLua = buf => {
  const t = buf.toString('utf8');
  const keys = {}, manifests = {};
  for (const m of t.matchAll(/addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*["']([0-9a-fA-F]{64})["']/g))
    keys[+m[1]] = m[2].toLowerCase();
  for (const m of t.matchAll(/setManifestid\s*\(\s*(\d+)\s*,\s*["'](\d+)["']/g))
    manifests[+m[1]] = m[2];
  return { keys, manifests };
};

const getHubData = async appId => {
  const lua = await fetchHub(appId, `${appId}.lua`);
  if (!lua) return null;
  return parseLua(lua);
};

// ─── auto depot selection ─────────────────────────────────────────────────
function pickBestDepot(depots, appId, manDir) {
  const eligible = depots.filter(d => d.manifestId && !SKIP_DEPOTS.has(d.id));
  const pool     = eligible.length ? eligible : depots.filter(d => d.manifestId);
  if (!pool.length) return null;

  const main = pool.find(d => d.id === appId + 1);
  if (main) return main;

  return pool
    .map(d => {
      const mp = path.join(manDir, `${d.id}_${d.manifestId}.manifest`);
      return { ...d, _sz: fs.existsSync(mp) ? fs.statSync(mp).size : 0 };
    })
    .sort((a, b) => b._sz - a._sz)[0];
}

// ─── SMART EXE FINDER ─────────────────────────────────────────────────────
const SKIP_EXE = /setup|install|uninst|dxsetup|vcredist|dotnet|redist|crashpad|crash(?:handler|reporter|report)|unitycrashandler|unrealcefsubprocess|epicwebhelper|cef_|cef\d|workshop|utility|updater|patcher|repair|benchmark|launchercheck|launch_check|be_service|easyanticheat|battleye_installer|physx|helper|handler|reporter|cleaner|diagnostic|service|injector|proxy|stub|wrapper|gameoverlayrenderer|steamerrorreporter|steamservice|webhelper|html_app/i;

function buildSkipRegex(appId) {
  const profile = GAME_PROFILES[appId];
  if (!profile?.skipExes?.length) return SKIP_EXE;
  const extra = profile.skipExes.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(SKIP_EXE.source + '|' + extra, 'i');
}

function scoreExeName(exePath, gameTitle) {
  if (!gameTitle || typeof gameTitle !== 'string') return 0;
  const base  = path.basename(exePath, '.exe').toLowerCase().replace(/[^a-z0-9]/g, '');
  const title = gameTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!base) return 0;
  if (base === title)                                    return 10000;
  if (title.startsWith(base) || base.startsWith(title)) return 7500;

  const short = title.replace(/[^a-z0-9]/g, '');
  if (short.length <= 6 && base.startsWith(short)) return 8000;
  if (short.length <= 6 && base.includes(short))   return 5000;

  const STOP = new Set(['the','and','for','of','in','on','a','an','is','to','at','by']);
  const tokens = gameTitle.toLowerCase()
    .split(/[\s\-_:,.'!?&()\[\]+/\\]+/)
    .map(t => t.replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length > 2 && !STOP.has(t));

  let score = 0;
  for (const tok of tokens) {
    if (base.includes(tok)) score += tok.length * 20;
  }
  if (tokens[0] && base.startsWith(tokens[0])) score += 60;

  return score;
}

function collectExes(dir, gameName, appId = 0, depth = 0, results = []) {
  if (depth > 3) return results;
  const skipRx = buildSkipRegex(appId);
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        collectExes(fullPath, gameName, appId, depth + 1, results);
        continue;
      }
      if (!e.name.toLowerCase().endsWith('.exe') || skipRx.test(e.name)) continue;
      try {
        const sz = fs.statSync(fullPath).size;
        if (sz < 64 * 1024) continue;
        results.push({ path: fullPath, size: sz, score: scoreExeName(fullPath, gameName) });
      } catch {}
    }
  } catch {}
  return results;
}

function findBestExe(dir, gameName, appId = 0) {
  // Profile override: if preferExe matches a real file, use it immediately
  const profile = GAME_PROFILES[appId];
  if (profile?.preferExe) {
    const preferred = findFileRecursive(dir, profile.preferExe, 3);
    if (preferred) {
      log(`Profile override — using exe: ${path.basename(preferred)}`, 'info');
      return preferred;
    }
  }

  const candidates = collectExes(dir, gameName, appId);
  if (!candidates.length) return null;
  const hasMatch = candidates.some(c => c.score > 0);
  if (hasMatch) return candidates.sort((a, b) => b.score - a.score || b.size - a.size)[0].path;
  return candidates.sort((a, b) => b.size - a.size)[0].path;
}

// walk dir up to `depth` levels looking for exact filename match (case-insensitive)
function findFileRecursive(dir, filename, depth = 2) {
  if (depth < 0) return null;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = findFileRecursive(fullPath, filename, depth - 1);
        if (found) return found;
      } else if (e.name.toLowerCase() === filename.toLowerCase()) {
        return fullPath;
      }
    }
  } catch {}
  return null;
}

// ─── Steam shortcut helpers ───────────────────────────────────────────────
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })();
  for (const byte of buf) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function deriveShortcutAppId(exePath, appName) {
  const payload = Buffer.from('\x00' + exePath + appName + '\x02');
  const top32   = crc32(payload);
  return ((top32 | 0x80000000) >>> 0);
}

async function findSteamUserdataDir(steamDir) {
  const ud = path.join(steamDir, 'userdata');
  if (!fs.existsSync(ud)) return null;
  for (const entry of fs.readdirSync(ud, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const uid = parseInt(entry.name, 10);
    if (uid && uid > 0 && uid !== 0) {
      const cfg = path.join(ud, entry.name, 'config');
      if (fs.existsSync(cfg)) return path.join(ud, entry.name);
    }
  }
  return null;
}

async function ensureNonSteamShortcut(steamDir, exePath, appName, appId) {
  const userDir = await findSteamUserdataDir(steamDir);
  if (!userDir) { log('Could not locate Steam userdata — shortcut injection skipped', 'warn'); return false; }

  const vdfPath = path.join(userDir, 'config', 'shortcuts.vdf');
  let   buf     = fs.existsSync(vdfPath) ? fs.readFileSync(vdfPath) : null;

  if (buf && buf.includes(Buffer.from(exePath))) {
    log(`Shortcut already exists for ${path.basename(exePath)}`, 'info');
    return true;
  }

  const existingCount = buf ? (buf.toString('binary').match(/\x00\d+\x00/g) || []).length : 0;
  const idx           = String(existingCount);

  function str(key, val)  { return Buffer.concat([Buffer.from('\x01'), Buffer.from(key + '\x00'), Buffer.from(val + '\x00')]); }
  function u32(key, val)  { const b = Buffer.alloc(5); b[0] = 0x02; b.write(key + '\x00', 1); b.writeUInt32LE(val >>> 0, key.length + 2); return b; }

  const entry = Buffer.concat([
    Buffer.from('\x00' + idx + '\x00'),
    str('appid',      String(appId)),
    str('AppName',    appName),
    str('Exe',        '"' + exePath + '"'),
    str('StartDir',   '"' + path.dirname(exePath) + '"'),
    str('icon',       ''),
    str('ShortcutPath',''),
    str('LaunchOptions',''),
    u32('IsHidden',   0),
    u32('AllowDesktopConfig', 1),
    u32('AllowOverlay',       1),
    u32('openvr',             0),
    u32('Devkit',             0),
    str('DevkitGameID', ''),
    u32('LastPlayTime', 0),
    Buffer.from('\x08\x08'),
  ]);

  if (!buf) {
    buf = Buffer.concat([Buffer.from('\x00shortcuts\x00'), entry, Buffer.from('\x08\x08')]);
  } else {
    const footer = buf.lastIndexOf(Buffer.from('\x08\x08'));
    if (footer > 0) {
      buf = Buffer.concat([buf.slice(0, footer), entry, buf.slice(footer)]);
    } else {
      buf = Buffer.concat([buf, entry]);
    }
  }

  await fsp.mkdir(path.dirname(vdfPath), { recursive: true });
  await fsp.writeFile(vdfPath, buf);
  log(`Non-Steam shortcut injected: ${appName} (shortcutId=${appId})`, 'success');
  return true;
}

async function findSteamExe() {
  const candidates = [
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Steam', 'steam.exe'),
    process.env['PROGRAMFILES']      && path.join(process.env['PROGRAMFILES'],       'Steam', 'steam.exe'),
    'C:\\Program Files (x86)\\Steam\\steam.exe',
    'C:\\Program Files\\Steam\\steam.exe',
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  try {
    const { stdout } = await execAsync('reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath 2>nul');
    const m = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/i);
    if (m) {
      const p = path.join(m[1].trim(), 'steam.exe');
      if (fs.existsSync(p)) return p;
    }
  } catch {}

  try {
    const { stdout } = await execAsync('reg query "HKLM\\SOFTWARE\\Valve\\Steam" /v InstallPath 2>nul');
    const m = stdout.match(/InstallPath\s+REG_SZ\s+(.+)/i);
    if (m) {
      const p = path.join(m[1].trim(), 'steam.exe');
      if (fs.existsSync(p)) return p;
    }
  } catch {}

  return null;
}

function isSteamRunning() {
  return new Promise(res => {
    exec('tasklist /FI "IMAGENAME eq steam.exe" /NH /FO CSV', (err, stdout) => {
      res(!err && stdout.toLowerCase().includes('steam.exe'));
    });
  });
}

// ─── Steam API ────────────────────────────────────────────────────────────
const steamSearch = async q => {
  const { data } = await axios.get('https://store.steampowered.com/api/storesearch/', {
    params: { term: q, cc: 'us', l: 'en', v: 1 }, timeout: 10000,
  });
  return (data?.items || []).filter(i => i.type === 'app');
};

const steamDetails = async appId => {
  const { data } = await axios.get('https://store.steampowered.com/api/appdetails', {
    params: { appids: appId, cc: 'us', l: 'en' }, timeout: 10000,
  });
  return data?.[String(appId)]?.data || null;
};

// ─── image URL cascade ────────────────────────────────────────────────────
// Returns an ordered list of CDN URLs to try for a given appid.
// Frontend picks the first that loads; falls back to generated SVG.
function getImageUrls(appId) {
  return [
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule_231x87.jpg`,
  ];
}

// ─── API ──────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json([]);
  try {
    const items = await steamSearch(q);
    res.json(items.slice(0, 24).map(i => ({
      appid   : i.id,
      name    : i.name,
      images  : getImageUrls(i.id),
      image   : `https://cdn.akamai.steamstatic.com/steam/apps/${i.id}/header.jpg`,
      portrait: `https://cdn.akamai.steamstatic.com/steam/apps/${i.id}/library_600x900.jpg`,
      price   : i.price?.final_formatted || 'Free',
      profile : GAME_PROFILES[i.id] ? { supported: true, notes: GAME_PROFILES[i.id].notes } : { supported: false },
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/game/:id', async (req, res) => {
  const id = +req.params.id;
  try {
    const [det, hub] = await Promise.all([steamDetails(id), getHubData(id)]);
    res.json({
      appid   : id,
      details : det,
      hub     : hub ? { available: true } : { available: false },
      images  : getImageUrls(id),
      profile : GAME_PROFILES[id] || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tools',       (_req, res) => res.json(toolStatus()));
app.get('/api/status',      (_req, res) => res.json({ activeJob }));
app.get('/api/library',     (_req, res) => res.json(loadLib()));
app.get('/api/profiles',    (_req, res) => res.json(GAME_PROFILES));

app.get('/api/steamstatus', async (_req, res) => {
  const exePath = await findSteamExe();
  const running = exePath ? await isSteamRunning() : false;
  res.json({ found: !!exePath, running, path: exePath || null });
});

app.post('/api/launch/:appid', async (req, res) => {
  const lib  = loadLib();
  const game = lib.find(g => g.appid === +req.params.appid);
  if (!game) return res.status(404).json({ error: 'Not in library' });

  const withController = req.query.controller === '1';

  let exe = game.execPath;
  if (!exe || !fs.existsSync(exe)) {
    exe = findBestExe(game.gameDir, game.name, game.appid);
  }
  if (!exe || !fs.existsSync(exe)) {
    return res.status(404).json({ error: 'Exe not found — game folder may have moved' });
  }

  if (exe !== game.execPath) upsertLib({ ...game, execPath: exe });

  if (withController) {
    const steamExe = await findSteamExe();
    if (steamExe) {
      const steamDir   = path.dirname(steamExe);
      const shortcutId = game.steamShortcutId || deriveShortcutAppId(exe, game.name);
      if (!game.steamShortcutId) upsertLib({ ...game, execPath: exe, steamShortcutId: shortcutId });

      await ensureNonSteamShortcut(steamDir, exe, game.name, shortcutId);

      const running = await isSteamRunning();
      if (!running) {
        log('Starting Steam for controller support…', 'info');
        spawn(steamExe, ['-silent'], { detached: true, stdio: 'ignore' }).unref();
        await new Promise(r => setTimeout(r, 4500));
        log('Steam ready — controller configs active', 'success');
      } else {
        log('Steam already running — controller configs active', 'success');
      }

      const steamUri = `steam://rungameid/${shortcutId}`;
      exec(`start "" "${steamUri}"`, { shell: true });
      log(`Launched via Steam shortcut bridge: ${path.basename(exe)} [controller mode]`, 'success');
      return res.json({ ok: true, exe: path.basename(exe), mode: 'steam-shortcut', shortcutId });
    } else {
      log('Steam not found — falling back to direct launch (no controller bridge)', 'warn');
    }
  }

  spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }).unref();
  log(`Launched: ${path.basename(exe)}${withController ? ' [direct, no Steam bridge]' : ''}`, 'success');
  res.json({ ok: true, exe: path.basename(exe) });
});

app.post('/api/download', (req, res) => {
  if (activeJob) return res.status(409).json({ error: 'Download already running' });
  const { appid, name } = req.body;
  if (!appid) return res.status(400).json({ error: 'appid required' });
  res.json({ ok: true });
  pipeline(+appid, name || `game_${appid}`).catch(e => {
    log(e.message, 'error');
    broadcast('job_done', { success: false, error: e.message });
    activeJob = null;
  });
});

app.get('/api/zip/:appid', (req, res) => {
  const p = path.join(ZIP_DIR, `${req.params.appid}.zip`);
  if (!fs.existsSync(p)) return res.status(404).end();
  res.download(p);
});

app.post('/api/library/setexe', (req, res) => {
  const { appid, execPath } = req.body;
  if (!appid || !execPath) return res.status(400).json({ error: 'appid + execPath required' });
  if (!fs.existsSync(execPath)) return res.status(404).json({ error: 'File not found: ' + execPath });
  upsertLib({ appid: +appid, execPath });
  res.json({ ok: true, execPath });
});

app.get('/api/library/exes/:appid', (req, res) => {
  const lib  = loadLib();
  const game = lib.find(g => g.appid === +req.params.appid);
  if (!game) return res.status(404).json({ error: 'Not in library' });
  const candidates = collectExes(game.gameDir, game.name, game.appid);
  const list = candidates
    .sort((a, b) => b.score - a.score || b.size - a.size)
    .map(c => ({ path: c.path, size: c.size, score: c.score, name: path.basename(c.path) }));
  res.json({ gameDir: game.gameDir, current: game.execPath || null, candidates: list });
});

// ─── pipeline ─────────────────────────────────────────────────────────────
async function pipeline(appId, name) {
  activeJob = { appid: appId, name, phase: 'init', pct: 0 };
  broadcast('job_start', { appid: appId, name });

  const profile  = GAME_PROFILES[appId];
  if (profile) log(`Game profile loaded: ${profile.name} — ${profile.notes}`, 'success');

  const gameRoot = path.join(DL_DIR, String(appId));
  const manDir   = path.join(gameRoot, '_manifests');
  const gameDir  = path.join(gameRoot, 'game');
  for (const d of [manDir, gameDir, ZIP_DIR]) await fsp.mkdir(d, { recursive: true });

  activeJob.phase = 'hub';
  setProgress(3, 'Checking manifest hub…');
  log(`Fetching ManifestHub3 for AppID ${appId}…`);

  const hub = await getHubData(appId);
  if (!hub) throw new Error(`AppID ${appId} not found in ManifestHub3 — game may not be available yet`);

  const allDepotIds = Object.keys(hub.keys).map(Number);
  log(`Found ${allDepotIds.length} depot key(s)`, 'success');
  setProgress(8, 'Hub found');

  activeJob.phase = 'manifests';
  setProgress(10, 'Downloading manifests…');

  for (const d of allDepotIds) {
    const mid   = hub.manifests[d];
    if (!mid) continue;
    const fname = `${d}_${mid}.manifest`;
    const dest  = path.join(manDir, fname);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100) continue;
    const data  = await fetchHub(appId, fname);
    if (!data) { log(`manifest ${fname} not on hub`, 'warn'); continue; }
    await fsp.writeFile(dest, data);
  }

  const keysPath = path.join(gameRoot, 'depot.keys');
  await fsp.writeFile(keysPath,
    Object.entries(hub.keys).map(([d, k]) => `${d};${k}`).join('\n') + '\n'
  );
  setProgress(14, 'Keys ready');

  const depotObjs = allDepotIds.map(d => ({ id: d, manifestId: hub.manifests[d] || null }));
  const best      = pickBestDepot(depotObjs, appId, manDir);
  if (!best) throw new Error('No suitable depot with manifest found — try another game');

  log(`Downloading depot ${best.id}`, 'success');

  const ddmod = findTool('DepotDownloaderMod.exe');
  if (!ddmod) throw new Error('DepotDownloaderMod.exe not found in tools/');

  const manFile = path.join(manDir, `${best.id}_${best.manifestId}.manifest`);
  if (!fs.existsSync(manFile)) throw new Error(`Manifest file missing for depot ${best.id}`);

  activeJob.phase = 'download';
  setProgress(15, 'Starting download…');

  const pctCb = p => setProgress(Math.round(15 + (p / 100) * 55), `${p.toFixed(1)}%`);

  await spawnStream(ddmod, [
    '-app',          String(appId),
    '-depot',        String(best.id),
    '-manifest',     best.manifestId,
    '-depotkeys',    keysPath,
    '-manifestfile', manFile,
    '-dir',          gameDir,
  ], pctCb);

  log('Download complete!', 'success');
  setProgress(70, 'Download done');

  activeJob.phase = 'steamless';
  const sl = findTool('Steamless.CLI.exe') || findTool('Steamless.exe');
  if (sl) {
    const exe = findBestExe(gameDir, name, appId);
    if (exe) {
      log(`Stripping DRM: ${path.basename(exe)}`, 'success');
      setProgress(72, 'Stripping Steam DRM…');
      const { crashed } = await spawnStream(sl, ['--quiet', exe]);
      const stripped    = await fixSteamlessOutput(exe);
      if (stripped)       log('DRM stripped ✓', 'success');
      else if (crashed)   log('Steamless crashed on this exe — game should still work as-is', 'warn');
    }
  }
  setProgress(82, 'DRM done');

  activeJob.phase = 'goldberg';
  setProgress(84, 'Applying Goldberg…');
  await applyGoldberg(gameDir, appId, name);
  setProgress(89, 'Goldberg done');

  const finalExe = findBestExe(gameDir, name, appId);
  upsertLib({
    appid   : appId,
    name,
    gameDir,
    execPath: finalExe || null,
    header  : `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    portrait: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    images  : getImageUrls(appId),
    addedAt : Date.now(),
    profile : profile ? { notes: profile.notes, arch: profile.arch } : null,
  });

  activeJob.phase = 'zip';
  const zipPath = path.join(ZIP_DIR, `${appId}.zip`);
  setProgress(91, 'Packaging…');
  await zipDir(gameDir, zipPath, appId, name);
  const { size } = fs.statSync(zipPath);
  log(`All done! ${(size / 1024 / 1024).toFixed(0)} MB`, 'success');
  setProgress(100, 'Complete');
  broadcast('job_done', { success: true, appid: appId, name, size });
  activeJob = null;
}

// ─── spawnStream ──────────────────────────────────────────────────────────
function spawnStream(exe, args, pctCb = null) {
  return new Promise((res, rej) => {
    const proc = spawn(exe, args, { cwd: path.dirname(exe) });
    let buf = '', preAllocCount = 0, inCrashStack = false, crashed = false, crashMsgNext = false;

    const flush = line => {
      const s = line.replace(/\r/g, '').trim();
      if (!s) return;

      if (/Caught unhandled exception/i.test(s)) {
        crashed = true; crashMsgNext = true;
        log('Steamless: unhandled exception — unpacking failed', 'error');
        return;
      }
      if (crashMsgNext) {
        if (/^[\x20-\x7E\t]+$/.test(s)) log(`  ${s}`, 'error');
        crashMsgNext = false; inCrashStack = true; return;
      }
      if (inCrashStack) {
        if (/^\[Steamless\]/i.test(s)) inCrashStack = false;
        else return;
      }

      if (/^Pre-allocating /i.test(s)) {
        preAllocCount++;
        if (preAllocCount === 1) log('Pre-allocating files on disk…');
        return;
      }
      if (preAllocCount > 0 && !/^Pre-allocating /i.test(s)) {
        log(`Pre-allocation done (${preAllocCount} files)`, 'success');
        preAllocCount = 0;
      }

      const pctMatch = s.match(/^\s*(\d{1,3}\.\d+)%/);
      if (pctMatch) {
        if (pctCb) pctCb(parseFloat(pctMatch[1]));
        return;
      }

      let lvl = 'info';
      if (/error|exception|failed/i.test(s))               lvl = 'error';
      else if (/warn/i.test(s))                             lvl = 'warn';
      else if (/done|complete|success|downloaded/i.test(s)) lvl = 'success';
      log(s, lvl);
    };

    proc.stdout?.on('data', d => {
      buf += d;
      const lines = buf.split('\n'); buf = lines.pop();
      lines.forEach(flush);
    });
    proc.stderr?.on('data', d =>
      d.toString().split('\n').forEach(l => { const t = l.trim(); if (t) log(t, 'warn'); })
    );
    proc.on('close', code => { if (buf) flush(buf); res({ code, crashed }); });
    proc.on('error', rej);
  });
}

// ─── exe helpers ──────────────────────────────────────────────────────────
async function fixSteamlessOutput(origExe) {
  const dir = path.dirname(origExe);
  for (const f of fs.readdirSync(dir)) {
    if (!f.includes('unpacked') && !f.includes('Unprotected')) continue;
    await fsp.rename(origExe, origExe + '.bak');
    await fsp.rename(path.join(dir, f), origExe);
    return true;
  }
  return false;
}

async function copyWithRetry(src, dest, retries = 4, delayMs = 1500) {
  for (let i = 0; i < retries; i++) {
    try { await fsp.copyFile(src, dest); return; }
    catch (e) {
      if (e.code === 'EBUSY' && i < retries - 1) {
        log(`${path.basename(dest)} locked — retrying…`, 'warn');
        await new Promise(r => setTimeout(r, delayMs));
      } else throw e;
    }
  }
}

async function applyGoldberg(dir, appId, gameName) {
  const profile = GAME_PROFILES[appId];
  const exe     = findBestExe(dir, gameName || '', appId);

  // arch detection: profile wins, then PE header sniff
  let is64 = profile?.arch ? profile.arch === 'x64' : true;
  if (!profile?.arch && exe) {
    try {
      const b = Buffer.alloc(0x200);
      const fd = fs.openSync(exe, 'r');
      fs.readSync(fd, b, 0, 0x200, 0);
      fs.closeSync(fd);
      if (b[0] === 0x4D && b[1] === 0x5A) {
        const lfanew = b.readUInt32LE(0x3C);
        if (lfanew + 6 < 0x200)
          is64 = b.readUInt16LE(lfanew + 4) === 0x8664;
      }
    } catch {}
  }
  log(`Detected arch: ${is64 ? 'x64' : 'x86'}${profile?.arch ? ' (from profile)' : ''}`, 'info');

  const src = is64
    ? (findTool('steam_api64.dll') || findTool('steam_api.dll'))
    : (findTool('steam_api.dll')   || findTool('steam_api64.dll'));

  if (src) {
    for (const dllName of ['steam_api.dll', 'steam_api64.dll']) {
      await copyWithRetry(src, path.join(dir, dllName));
    }
    log('steam_api.dll + steam_api64.dll placed (Goldberg)', 'success');
  } else {
    log('steam_api.dll not in tools/ — Goldberg not applied', 'warn');
  }

  await fsp.writeFile(path.join(dir, 'steam_appid.txt'), String(appId));
  log(`steam_appid.txt → ${appId}`, 'success');

  // Profile extra files
  if (profile?.extraCopy) {
    for (const { src: srcName, dst, optional } of profile.extraCopy) {
      const srcPath = findTool(srcName);
      if (srcPath) {
        await copyWithRetry(srcPath, path.join(dir, dst));
        log(`Extra file placed: ${dst}`, 'success');
      } else if (!optional) {
        log(`Missing required extra file: ${srcName}`, 'warn');
      }
    }
  }
}

// ─── zip with readme ──────────────────────────────────────────────────────
function zipDir(src, out, appId = 0, gameName = '') {
  return new Promise((res, rej) => {
    const o = fs.createWriteStream(out);
    const a = archiver('zip', { zlib: { level: 0 } });
    o.on('close', res); a.on('error', rej);

    // Build a HOW_TO_PLAY.txt inside the zip
    const profile = GAME_PROFILES[appId];
    const readmeLines = [
      `Game: ${gameName} (AppID ${appId})`,
      `Patched by: spined.lol v4.0 — by 0847x`,
      ``,
      `HOW TO PLAY`,
      `───────────`,
      `1. Extract this zip anywhere.`,
      `2. Run the main .exe (see LAUNCH NOTES below).`,
      `3. No Steam required. All DRM stripped + Goldberg emulator applied.`,
      ``,
      `WHAT'S INCLUDED`,
      `───────────────`,
      `• Game files (all depots merged)`,
      `• steam_api.dll / steam_api64.dll  — Goldberg Steam emulator`,
      `• steam_appid.txt                  — tells the game its own AppID`,
      profile ? `• steam_interfaces.txt (if present) — interface list for Goldberg` : '',
      ``,
      `LAUNCH NOTES`,
      `────────────`,
      profile
        ? [`Profile: ${profile.name}`,
           `Preferred exe: ${profile.preferExe || 'auto-detected'}`,
           `Notes: ${profile.notes}`,
           profile.skipExes?.length ? `Skip these: ${profile.skipExes.join(', ')}` : ''].filter(Boolean).join('\n')
        : `No specific profile — run the largest .exe in the game folder.`,
      ``,
      `Built with spined.lol — cracked by 0847x`,
    ].filter(l => l !== '').join('\n');

    a.append(Buffer.from(readmeLines), { name: 'HOW_TO_PLAY.txt' });
    a.pipe(o);
    a.directory(src, false);
    a.finalize();
  });
}

// ─── boot ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  const ts  = toolStatus();
  const url = `http://localhost:${PORT}`;
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║      spined.lol  v4.0  by 0847x      ║`);
  console.log(`  ╚══════════════════════════════════════╝`);
  console.log(`  → ${url}\n`);
  console.log(`  tools/`);
  console.log(`    DepotDownloaderMod.exe  ${ts.depotDownloader ? '✓' : '✗  ← place in tools/'}`);
  console.log(`    Steamless.CLI.exe       ${ts.steamless       ? '✓' : '✗  ← optional'}`);
  console.log(`    steam_api.dll           ${ts.steamApi        ? '✓' : '✗  ← place in tools/'}\n`);
  console.log(`  Game profiles loaded: ${Object.keys(GAME_PROFILES).length} games\n`);
});

module.exports = { server, PORT };
