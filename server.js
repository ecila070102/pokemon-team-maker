/* ============================================================
 *  GBA PARTY-SCREEN RENDERER  (Monitor + 5-player team)
 *  POST /render
 *    { monitor:"name", hour:1, players:[{name,pokemon,level,lead,total}] }
 *  -> { link }
 *  Upload: ImgBB (env IMGBB_API_KEY).  Optional API_KEY to lock endpoint.
 * ============================================================ */

const express = require('express');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const FONT_NAME = 'PartyFont';

// Pokemon sprite set: 'box' = PC/menu icons, 'frlg' = Gen3 battle, 'gen1', 'gen2'
const SPRITE_STYLE = 'box';
// Trainer sprites for the Monitor box (Showdown). A name is picked per render;
// if none given, one of COMMON_TRAINERS is chosen at random.
const TRAINER_BASE = 'https://play.pokemonshowdown.com/sprites/trainers/';
const DEFAULT_TRAINER = process.env.DEFAULT_TRAINER || 'red';
const COMMON_TRAINERS = ['red','leaf','blue','ethan','lyra','brendan','may','lucas','dawn','silver'];

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

// ---------- pokemon sprites ----------
const spriteCache = new Map();
const slugify = (s) => String(s || '').toLowerCase().trim()
  .replace(/♀/g, '-f').replace(/♂/g, '-m').replace(/[.'’]/g, '').replace(/\s+/g, '-');

function pickSpriteUrl(d) {
  const v = d?.sprites?.versions || {};
  const fb = d?.sprites?.front_default;
  switch (SPRITE_STYLE) {
    case 'box':  return v['generation-viii']?.icons?.front_default
                     || v['generation-vii']?.icons?.front_default || fb;
    case 'frlg': return v['generation-iii']?.['firered-leafgreen']?.front_default || fb;
    case 'gen1': return v['generation-i']?.['red-blue']?.front_default || fb;
    case 'gen2': return v['generation-ii']?.crystal?.front_default
                     || v['generation-ii']?.gold?.front_default || fb;
    default:     return fb;
  }
}
async function getSprite(species) {
  const slug = slugify(species);
  if (!slug) return null;
  if (spriteCache.has(slug)) return spriteCache.get(slug);
  try {
    const r = await fetch('https://pokeapi.co/api/v2/pokemon/' + encodeURIComponent(slug));
    if (!r.ok) { spriteCache.set(slug, null); return null; }
    const d = await r.json();
    const url = pickSpriteUrl(d);
    if (!url) { spriteCache.set(slug, null); return null; }
    const ir = await fetch(url);
    const img = await loadImage(Buffer.from(await ir.arrayBuffer()));
    spriteCache.set(slug, img);
    return img;
  } catch (e) { spriteCache.set(slug, null); return null; }
}

// ---------- trainer sprite (cached per name) ----------
const trainerCache = new Map();
function trainerSlug(s) {
  return String(s || '').toLowerCase().trim().replace(/[.'\u2019]/g, '').replace(/\s+/g, '');
}
async function getTrainer(name) {
  let slug = trainerSlug(name);
  if (!slug) slug = COMMON_TRAINERS[Math.floor(Math.random() * COMMON_TRAINERS.length)];
  if (trainerCache.has(slug)) return trainerCache.get(slug);
  try {
    const r = await fetch(TRAINER_BASE + encodeURIComponent(slug) + '.png');
    if (!r.ok) throw new Error('http ' + r.status);
    const img = await loadImage(Buffer.from(await r.arrayBuffer()));
    trainerCache.set(slug, img);
    return img;
  } catch (e) {
    console.warn('trainer fetch failed (' + slug + '):', e.message);
    // fall back to default once, if we weren't already trying it
    if (slug !== trainerSlug(DEFAULT_TRAINER)) return getTrainer(DEFAULT_TRAINER);
    trainerCache.set(slug, null);
    return null;
  }
}

// ---------- padding trim + fit ----------
const bboxCache = new WeakMap();
function contentBBox(sprite) {
  if (bboxCache.has(sprite)) return bboxCache.get(sprite);
  const w = sprite.width, h = sprite.height;
  let box = { x: 0, y: 0, w, h };
  try {
    const tmp = createCanvas(w, h);
    const tctx = tmp.getContext('2d');
    tctx.drawImage(sprite, 0, 0);
    const data = tctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX >= minX && maxY >= minY) box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  } catch (e) {}
  bboxCache.set(sprite, box);
  return box;
}
function drawSpriteFit(ctx, sprite, cx, cy, maxSize, ratio = 0.8) {
  if (!sprite) return;
  const b = contentBBox(sprite);
  const target = maxSize * ratio;
  const scale = Math.min(target / b.w, target / b.h);
  const dw = Math.round(b.w * scale), dh = Math.round(b.h * scale);
  ctx.drawImage(sprite, b.x, b.y, b.w, b.h,
    Math.round(cx - dw / 2), Math.round(cy - dh / 2), dw, dh);
}

// ---------- palette ----------
const C = {
  bg:'#d8b878', stripe:'rgba(255,255,255,0.06)',
  leadFill1:'#90d4dc', leadFill2:'#74c0ca', leadBorder:'#f08868',
  panelFill1:'#5c94d4', panelFill2:'#3c74bc', panelTop:'#8cbcec', panelBorder:'#1c4c94',
  hpLabel:'#f0b028', hpBox:'#181c22', hpTrack:'#2c3440',
  textLight:'#f8f8f8', shadowDark:'#404858', shadowOnCyan:'#3c7078',
  boxBorder:'#1c4c94', boxFill:'#f8f8f8', boxText:'#404858', cancel:'#d83838'
};

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
  ctx.font = font(size); ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = shadow || C.shadowDark; ctx.fillText(txt, x + 2, y + 2);
  ctx.fillStyle = color || C.textLight;   ctx.fillText(txt, x, y);
}
function rightText(ctx, txt, rightX, y, size, color, shadow) {
  ctx.font = font(size);
  text(ctx, txt, rightX - ctx.measureText(txt).width, y, size, color, shadow);
}
function hpBarBlock(ctx, barX, barW, top, h) {
  ctx.fillStyle = C.hpBox;   roundRect(ctx, barX - 2, top - 2, barW + 4, h + 4, 3); ctx.fill();
  ctx.fillStyle = C.hpTrack; ctx.fillRect(barX, top, barW, h);
  ctx.fillStyle = '#58c838'; ctx.fillRect(barX, top, barW, h);   // always full + green (cosmetic)
  ctx.fillStyle = '#90f070'; ctx.fillRect(barX, top, barW, 3);
}

// Monitor box (trainer sprite + monitor name) in the big top-left slot
function drawMonitor(ctx, monitorName, trainer) {
  const x = 28, y = 66, w = 372, h = 258, sh = C.shadowOnCyan;
  ctx.fillStyle = C.leadBorder; roundRect(ctx, x, y, w, h, 12); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, C.leadFill1); g.addColorStop(1, C.leadFill2);
  ctx.fillStyle = g; roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 8); ctx.fill();

  drawSpriteFit(ctx, trainer, x + w / 2, y + 92, 160, 0.92);
  text(ctx, 'Monitor', x + 24, y + h - 86, 16, C.hpLabel, sh);
  text(ctx, monitorName || '—', x + 24, y + h - 52, 24, C.textLight, sh);
}

// One player panel in the right column
function drawPanel(ctx, p, y, sprite) {
  const x = 404, w = 648, h = 92, sh = C.shadowDark;
  ctx.fillStyle = C.panelBorder; roundRect(ctx, x, y, w, h, 10); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, C.panelFill1); g.addColorStop(1, C.panelFill2);
  ctx.fillStyle = g; roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 7); ctx.fill();
  ctx.fillStyle = C.panelTop; roundRect(ctx, x + 4, y + 4, w - 8, 6, 7); ctx.fill();

  drawSpriteFit(ctx, sprite, x + 50, y + h / 2, 70, 0.78);
  text(ctx, p.name, x + 92, y + 38, 20, C.textLight, sh);
  text(ctx, 'Lv' + p.level, x + 92, y + 68, 17, C.textLight, sh);
  text(ctx, 'HP', x + 330, y + 40, 13, C.hpLabel, sh);
  hpBarBlock(ctx, x + 364, w - 364 - 18, y + 32, 8);
  rightText(ctx, hpStr(p), x + w - 18, y + 72, 17, C.textLight, sh);
}

function drawBackground(ctx, hourLabel) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, 1080, 720);
  ctx.strokeStyle = C.stripe; ctx.lineWidth = 26;
  for (let i = -720; i < 1080; i += 92) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 720, 720); ctx.stroke();
  }
  ctx.fillStyle = C.boxBorder; roundRect(ctx, 18, 612, 772, 90, 10); ctx.fill();
  ctx.fillStyle = C.boxFill;   roundRect(ctx, 26, 620, 756, 74, 7); ctx.fill();
  text(ctx, hourLabel, 46, 670, 24, C.boxText, '#c8c8c8');
  ctx.fillStyle = C.cancel; ctx.beginPath(); ctx.arc(898, 657, 30, 0, Math.PI * 2); ctx.fill();
  text(ctx, 'CANCEL', 942, 668, 22, C.textLight, C.shadowDark);
}

async function renderParty(players, monitor, hourLabel, trainerName) {
  await ensureFont();
  // fetch trainer + all player sprites concurrently (much faster than one-by-one)
  const [trainer, ...sprites] = await Promise.all([
    getTrainer(trainerName),
    ...players.map(p => getSprite(p.species))
  ]);

  const canvas = createCanvas(1080, 720);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawBackground(ctx, hourLabel);
  drawMonitor(ctx, monitor, trainer);
  const n = Math.min(players.length, 5);
  for (let i = 0; i < n; i++) drawPanel(ctx, players[i], 24 + i * 108, sprites[i]);
  return canvas.toBuffer('image/png');
}

// ---------- ImgBB upload (30-day expiry) ----------
async function uploadImage(pngBuffer) {
  const form = new FormData();
  form.append('image', pngBuffer.toString('base64'));
  const EXPIRE_SECONDS = 30 * 24 * 60 * 60;
  const url = 'https://api.imgbb.com/1/upload?expiration=' + EXPIRE_SECONDS
            + '&key=' + encodeURIComponent(process.env.IMGBB_API_KEY);
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
    const raw = Array.isArray(req.body?.players) ? req.body.players.slice(0, 5) : [];
    if (!raw.length) return res.status(400).json({ error: 'no players' });
    const players = raw.map(p => ({
      name: String(p.name || '').slice(0, 24),
      species: String(p.pokemon ?? p.species ?? ''),
      level: Number(p.level) || 0,
      hpCur: Number(p.lead ?? p.hpCur) || 0,
      hpMax: Number(p.total ?? p.hpMax) || 0
    }));
    const monitor = String(req.body?.monitor || '').slice(0, 24);
    const hour = req.body?.hour;
    const hourLabel = (hour === undefined || hour === null || hour === '') ? 'Hour' : ('Hour ' + hour);
    const trainerName = String(req.body?.trainerSprite || '').slice(0, 40);
    const png = await renderParty(players, monitor, hourLabel, trainerName);
    const link = await uploadImage(png);
    res.json({ link });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Renderer listening on :' + PORT));
