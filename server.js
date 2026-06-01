/* ============================================================
 *  GBA PARTY-SCREEN RENDERER  (FireRed/LeafGreen faithful)
 *  POST /render  { players:[{name,species,level,hpCur,hpMax}] }  -> { link }
 *  Upload host: ImgBB (env IMGBB_API_KEY).  Optional API_KEY to lock endpoint.
 * ============================================================ */

const express = require('express');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const FONT_NAME = 'PartyFont';

// ---------- font ----------
let fontReady = false;
async function ensureFont() {
  if (fontReady) return;
  try {
    const url = 'https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf';
    const r = await fetch(url);
    GlobalFonts.register(Buffer.from(await r.arrayBuffer()), FONT_NAME);
  } catch (e) { console.warn('font fetch failed:', e.message); }
  fontReady = true;
}
const font = (px) => (fontReady ? `${px}px "${FONT_NAME}"` : `bold ${px}px monospace`);

// ---------- sprites ----------
const spriteCache = new Map();
const slugify = (s) => String(s || '').toLowerCase().trim()
  .replace(/♀/g, '-f').replace(/♂/g, '-m').replace(/[.'’]/g, '').replace(/\s+/g, '-');
async function getSprite(species) {
  const slug = slugify(species);
  if (!slug) return null;
  if (spriteCache.has(slug)) return spriteCache.get(slug);
  try {
    const r = await fetch('https://pokeapi.co/api/v2/pokemon/' + encodeURIComponent(slug));
    if (!r.ok) { spriteCache.set(slug, null); return null; }
    const d = await r.json();
    const url = d?.sprites?.versions?.['generation-iii']?.['firered-leafgreen']?.front_default
             || d?.sprites?.front_default;
    if (!url) { spriteCache.set(slug, null); return null; }
    const ir = await fetch(url);
    const img = await loadImage(Buffer.from(await ir.arrayBuffer()));
    spriteCache.set(slug, img);
    return img;
  } catch (e) { spriteCache.set(slug, null); return null; }
}

// ---------- palette (FRLG) ----------
const C = {
  bg:        '#d8b878',
  stripe:    'rgba(255,255,255,0.06)',
  leadFill1: '#90d4dc', leadFill2: '#74c0ca', leadBorder: '#f08868',
  panelFill1:'#5c94d4', panelFill2:'#3c74bc', panelTop:'#8cbcec', panelBorder:'#1c4c94',
  hpLabel:   '#f0b028',
  hpBox:     '#283038', hpTrack:'#586068',
  textLight: '#f8f8f8', shadowDark:'#404858', shadowOnCyan:'#3c7078',
  boxBorder: '#1c4c94', boxFill:'#f8f8f8', boxText:'#404858',
  cancel:    '#d83838'
};
function hpColors(frac) {
  if (frac > 0.5) return ['#58c838', '#90f070'];
  if (frac > 0.2) return ['#f0c030', '#f8e870'];
  return ['#f04838', '#f89880'];
}

// ---------- draw helpers ----------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const hpStr = (p) => (p.hpMax ? `${p.hpCur}/ ${p.hpMax}` : '—');
function text(ctx, txt, x, y, size, color, shadow) {
  ctx.font = font(size);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = shadow || C.shadowDark; ctx.fillText(txt, x + 2, y + 2);
  ctx.fillStyle = color || C.textLight;   ctx.fillText(txt, x, y);
}
function rightText(ctx, txt, rightX, y, size, color, shadow) {
  ctx.font = font(size);
  const w = ctx.measureText(txt).width;
  text(ctx, txt, rightX - w, y, size, color, shadow);
}
function hpBarBlock(ctx, barX, barW, top, h, cur, max) {
  ctx.fillStyle = C.hpBox;   roundRect(ctx, barX - 2, top - 2, barW + 4, h + 4, 3); ctx.fill();
  ctx.fillStyle = C.hpTrack; ctx.fillRect(barX, top, barW, h);
  const frac = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 1;
  const [c1, c2] = hpColors(frac);
  ctx.fillStyle = c1; ctx.fillRect(barX, top, barW * frac, h);
  ctx.fillStyle = c2; ctx.fillRect(barX, top, barW * frac, 3);
}

function drawLead(ctx, p, sprite) {
  const x = 28, y = 66, w = 372, h = 258, sh = C.shadowOnCyan;
  ctx.fillStyle = C.leadBorder; roundRect(ctx, x, y, w, h, 12); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, C.leadFill1); g.addColorStop(1, C.leadFill2);
  ctx.fillStyle = g; roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 8); ctx.fill();

  if (sprite) ctx.drawImage(sprite, x + w / 2 - 64, y + 22, 128, 128);
  text(ctx, p.name, x + 24, y + h - 92, 24, C.textLight, sh);
  text(ctx, 'Lv' + p.level, x + 24, y + h - 60, 20, C.textLight, sh);
  rightText(ctx, hpStr(p), x + w - 24, y + h - 56, 18, C.textLight, sh);
  text(ctx, 'HP', x + 28, y + h - 10, 13, C.hpLabel, sh);
  hpBarBlock(ctx, x + 60, w - 88, y + h - 22, 9, p.hpCur, p.hpMax);
}

function drawPanel(ctx, p, y, sprite) {
  const x = 404, w = 648, h = 92, sh = C.shadowDark;
  ctx.fillStyle = C.panelBorder; roundRect(ctx, x, y, w, h, 10); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, C.panelFill1); g.addColorStop(1, C.panelFill2);
  ctx.fillStyle = g; roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 7); ctx.fill();
  ctx.fillStyle = C.panelTop; roundRect(ctx, x + 4, y + 4, w - 8, 6, 7); ctx.fill();

  if (sprite) ctx.drawImage(sprite, x + 12, y + (h - 64) / 2, 64, 64);
  text(ctx, p.name, x + 92, y + 38, 20, C.textLight, sh);
  text(ctx, 'Lv' + p.level, x + 92, y + 68, 17, C.textLight, sh);
  text(ctx, 'HP', x + 330, y + 40, 13, C.hpLabel, sh);
  hpBarBlock(ctx, x + 364, w - 364 - 18, y + 32, 8, p.hpCur, p.hpMax);
  rightText(ctx, hpStr(p), x + w - 18, y + 72, 17, C.textLight, sh);
}

function drawBackground(ctx) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, 1080, 720);
  ctx.strokeStyle = C.stripe; ctx.lineWidth = 26;
  for (let i = -720; i < 1080; i += 92) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 720, 720); ctx.stroke();
  }
  ctx.fillStyle = C.boxBorder; roundRect(ctx, 18, 612, 772, 90, 10); ctx.fill();
  ctx.fillStyle = C.boxFill;   roundRect(ctx, 26, 620, 756, 74, 7); ctx.fill();
  text(ctx, 'Choose a POKéMON.', 46, 670, 22, C.boxText, '#c8c8c8');
  ctx.fillStyle = C.cancel; ctx.beginPath(); ctx.arc(898, 657, 30, 0, Math.PI * 2); ctx.fill();
  text(ctx, 'CANCEL', 942, 668, 22, C.textLight, C.shadowDark);
}

async function renderParty(players) {
  await ensureFont();
  const sprites = [];
  for (const p of players) sprites.push(await getSprite(p.species));

  const canvas = createCanvas(1080, 720);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;   // crisp pixel sprites
  drawBackground(ctx);
  drawLead(ctx, players[0], sprites[0]);
  for (let i = 1; i < players.length && i < 6; i++) {
    drawPanel(ctx, players[i], 28 + (i - 1) * 108, sprites[i]);
  }
  return canvas.toBuffer('image/png');
}

// ---------- ImgBB upload ----------
async function uploadImage(pngBuffer) {
  const form = new FormData();
  form.append('image', pngBuffer.toString('base64'));
  const url = 'https://api.imgbb.com/1/upload?key=' + encodeURIComponent(process.env.IMGBB_API_KEY);
  const r = await fetch(url, { method: 'POST', body: form });
  const data = await r.json();
  if (!data || !data.success) throw new Error('ImgBB said: ' + JSON.stringify(data && (data.error || data)));
  return data.data.url;
}

// ---------- routes ----------
app.get('/', (_req, res) => res.send('GBA party renderer is up.'));

app.post('/render', async (req, res) => {
  try {
    if (API_KEY && req.get('x-api-key') !== API_KEY) return res.status(401).json({ error: 'bad api key' });
    const raw = Array.isArray(req.body?.players) ? req.body.players.slice(0, 6) : [];
    if (!raw.length) return res.status(400).json({ error: 'no players' });
    const players = raw.map(p => ({
      name: String(p.name || '').slice(0, 24),
      species: String(p.species || ''),
      level: Number(p.level) || 0,
      hpCur: Number(p.hpCur) || 0,
      hpMax: Number(p.hpMax) || 0
    }));
    const png = await renderParty(players);
    const link = await uploadImage(png);
    res.json({ link });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Renderer listening on :' + PORT));
