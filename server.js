/* ============================================================
 *  GBA PARTY-SCREEN RENDERER  (external service)
 *  ------------------------------------------------------------
 *  POST /render
 *    headers: x-api-key: <API_KEY>   (only if API_KEY env is set)
 *    body (JSON): {
 *      players: [ { name, species, level, hpCur, hpMax }, ... up to 5 ]
 *    }
 *  -> { link: "https://files.catbox.moe/xxxx.png" }
 *
 *  Node 18+ (global fetch / FormData / Blob).  No API keys needed
 *  for Catbox.  Set API_KEY env to lock the endpoint down.
 * ============================================================ */

const express = require('express');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';      // optional shared secret
const FONT_NAME = 'PartyFont';

// ---- font loading (Press Start 2P from Google Fonts) ----
let fontReady = false;
async function ensureFont() {
  if (fontReady) return;
  try {
    const url = 'https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf';
    const r = await fetch(url);
    const buf = Buffer.from(await r.arrayBuffer());
    GlobalFonts.register(buf, FONT_NAME);
  } catch (e) {
    console.warn('Font fetch failed, falling back to default monospace:', e.message);
  }
  fontReady = true;
}
function font(px) {
  return fontReady ? `${px}px "${FONT_NAME}"` : `bold ${px}px monospace`;
}

// ---- sprite resolution via PokeAPI (cached) ----
const spriteCache = new Map();
function slugify(species) {
  return String(species || '')
    .toLowerCase().trim()
    .replace(/♀/g, '-f').replace(/♂/g, '-m')
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, '-');
}
async function getSpriteImage(species) {
  const slug = slugify(species);
  if (!slug) return null;
  if (spriteCache.has(slug)) return spriteCache.get(slug);
  try {
    const r = await fetch('https://pokeapi.co/api/v2/pokemon/' + encodeURIComponent(slug));
    if (!r.ok) { spriteCache.set(slug, null); return null; }
    const d = await r.json();
    const url =
      d?.sprites?.versions?.['generation-iii']?.['firered-leafgreen']?.front_default ||
      d?.sprites?.front_default;
    if (!url) { spriteCache.set(slug, null); return null; }
    const ir = await fetch(url);
    const img = await loadImage(Buffer.from(await ir.arrayBuffer()));
    spriteCache.set(slug, img);
    return img;
  } catch (e) {
    spriteCache.set(slug, null);
    return null;
  }
}

// ---- drawing helpers ----
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function shadowText(ctx, txt, x, y, size, color) {
  ctx.font = font(size);
  ctx.fillStyle = '#404858'; ctx.fillText(txt, x + 2, y + 2);
  ctx.fillStyle = color || '#ffffff'; ctx.fillText(txt, x, y);
}
function hpColors(frac) {
  if (frac > 0.5) return ['#58d048', '#a0f078'];
  if (frac > 0.2) return ['#f8c038', '#fce878'];
  return ['#f85838', '#fca0a0'];
}
function drawHpBar(ctx, x, y, w, cur, max) {
  const frac = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 1;
  shadowText(ctx, 'HP', x, y - 4, 14, '#f0a838');
  const bx = x + 34, bw = w - 34, bh = 9;
  ctx.fillStyle = '#202830'; roundRect(ctx, bx - 2, y - 15, bw + 4, bh + 4, 3); ctx.fill();
  ctx.fillStyle = '#586068'; ctx.fillRect(bx, y - 13, bw, bh);
  const [c1, c2] = hpColors(frac);
  ctx.fillStyle = c1; ctx.fillRect(bx, y - 13, bw * frac, bh);
  ctx.fillStyle = c2; ctx.fillRect(bx, y - 13, bw * frac, 3);
}
function drawPanel(ctx, p, x, y, w, h, big, sprite) {
  ctx.fillStyle = big ? '#f87858' : '#3868a8';
  roundRect(ctx, x, y, w, h, 12); ctx.fill();
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, '#6fa8d8'); grad.addColorStop(1, '#4880b8');
  ctx.fillStyle = grad; roundRect(ctx, x + 5, y + 5, w - 10, h - 10, 9); ctx.fill();

  const hp = p.hpMax ? `${p.hpCur}/ ${p.hpMax}` : '—';
  if (big) {
    const cx = x + w / 2;
    if (sprite) ctx.drawImage(sprite, cx - 64, y + 24, 128, 128);
    shadowText(ctx, p.name, x + 24, y + h - 72, 22);
    shadowText(ctx, 'Lv' + p.level, x + 24, y + h - 44, 18);
    drawHpBar(ctx, x + 30, y + h - 14, w - 60, p.hpCur, p.hpMax);
    shadowText(ctx, hp, x + w - 24 - hp.length * 11, y + h - 30, 16);
  } else {
    if (sprite) ctx.drawImage(sprite, x + 12, y + (h - 72) / 2, 72, 72);
    shadowText(ctx, p.name, x + 96, y + 34, 18);
    shadowText(ctx, 'Lv' + p.level, x + 96, y + 62, 15);
    drawHpBar(ctx, x + 330, y + 38, 260, p.hpCur, p.hpMax);
    shadowText(ctx, hp, x + w - 28 - hp.length * 11, y + 72, 15);
  }
}
function drawBackground(ctx) {
  ctx.fillStyle = '#d8c088'; ctx.fillRect(0, 0, 1080, 720);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 24;
  for (let i = -720; i < 1080; i += 80) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 720, 720); ctx.stroke();
  }
  ctx.fillStyle = '#3868a8'; roundRect(ctx, 20, 612, 760, 88, 10); ctx.fill();
  ctx.fillStyle = '#f8f8f8'; roundRect(ctx, 28, 620, 744, 72, 8); ctx.fill();
  shadowText(ctx, 'Choose a POKéMON.', 48, 668, 22, '#404858');
  ctx.fillStyle = '#d83838'; ctx.beginPath(); ctx.arc(900, 656, 30, 0, Math.PI * 2); ctx.fill();
  shadowText(ctx, 'CANCEL', 945, 666, 20, '#f8f8f8');
}

async function renderParty(players) {
  await ensureFont();
  const sprites = [];
  for (const p of players) sprites.push(await getSpriteImage(p.species));

  const canvas = createCanvas(1080, 720);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx);
  drawPanel(ctx, players[0], 28, 70, 360, 250, true, sprites[0]);
  for (let i = 1; i < players.length && i < 6; i++) {
    drawPanel(ctx, players[i], 400, 30 + (i - 1) * 112, 656, 100, false, sprites[i]);
  }
  return canvas.toBuffer('image/png');
}

// ---- Catbox upload ----
async function uploadToCatbox(pngBuffer) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', new Blob([pngBuffer], { type: 'image/png' }), 'party.png');
  const r = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: form });
  const text = (await r.text()).trim();
  if (!/^https?:\/\//.test(text)) throw new Error('Catbox said: ' + text);
  return text;
}

// ---- routes ----
app.get('/', (_req, res) => res.send('GBA party renderer is up.'));

app.post('/render', async (req, res) => {
  try {
    if (API_KEY && req.get('x-api-key') !== API_KEY) {
      return res.status(401).json({ error: 'bad api key' });
    }
    const players = Array.isArray(req.body?.players) ? req.body.players.slice(0, 6) : [];
    if (!players.length) return res.status(400).json({ error: 'no players' });

    const norm = players.map(p => ({
      name: String(p.name || '').slice(0, 24),
      species: String(p.species || ''),
      level: Number(p.level) || 0,
      hpCur: Number(p.hpCur) || 0,
      hpMax: Number(p.hpMax) || 0
    }));

    const png = await renderParty(norm);
    const link = await uploadToCatbox(png);
    res.json({ link });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Renderer listening on :' + PORT));
