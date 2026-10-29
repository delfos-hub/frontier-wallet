// nft.js - the address's NFTs, grouped by collection.
//
// There is no list of all CW721 collections to ask, so collections are found
// the way tokens are: from the contracts this address has dealt with, each
// asked {tokens:{owner}} - a CW721 answers with ids, anything else refuses.
//
// What made the tab slow was doing all of that, every time, before showing
// anything: dozens of contracts asked, then every picture's metadata fetched
// from an IPFS gateway. Now:
//   - the collections found last time are drawn at once, then re-read;
//   - a contract that refused once is not asked again (it is not a CW721);
//   - all ids are read, page by page, not only the first 30;
//   - a picture is fetched only when its card scrolls into view, and its
//     address is kept, so a second visit draws from cache;
//   - each collection shows four and opens to all of them;
//   - tapping a card opens it: the picture, its name, traits and contract.
import { LCD, getJSON, smart } from './chain.js?v=c36e8f7f';
import { $, tap } from './shell.js?v=c36e8f7f';
import { cacheGet, cacheSet, mapLimit, txCandidates } from './market.js?v=c36e8f7f';
import { S } from './state.js?v=c36e8f7f';

const PREVIEW = 4;              // cards per collection before "See all"
const MAX_IDS = 1000;           // ids read per collection, 100 a page
const FINDER = 'https://finder.terraclassic.community/columbus-5/address/';
let LOADED = '', BUSY = false, COLS = [], OPEN = {};

const me = () => S.ADDR || (S.SAVED && S.SAVED.addr) || '';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function permGet(k){ try { const v = localStorage.getItem('fw:perm:' + k); return v === null ? undefined : JSON.parse(v); } catch (e) { return undefined; } }
function permSet(k, v){ try { localStorage.setItem('fw:perm:' + k, JSON.stringify(v)); } catch (e) {} }

// a contract's own "no" vs a node that did not answer (only the first is kept)
function refused(e){
  if (!e || typeof e.status !== 'number') return false;
  if (e.refused) return true;
  if (e.status >= 400 && e.status < 500 && e.status !== 429) return true;
  return /query wasm contract failed|Error parsing|unknown variant|not found/i.test(e.body || '');
}

/* ---------------- finding the collections ---------------- */
async function contractsFor(addr){
  const hit = cacheGet('nftc:' + addr);
  if (hit) return hit;
  const evs = ["wasm.recipient='" + addr + "'", "wasm.owner='" + addr + "'", "wasm.to='" + addr + "'"];
  const pages = await Promise.all(evs.map(ev =>
    getJSON(LCD + '/cosmos/tx/v1beta1/txs?query=' + encodeURIComponent(ev) +
      '&pagination.limit=100&order_by=ORDER_BY_DESC', 25000).catch(() => ({}))));
  const out = {};
  for (const r of pages)
    for (const t of (r.tx_responses || []))
      for (const lg of (t.logs || []))
        for (const e of (lg.events || []))
          if (e.type === 'wasm')
            for (const a of (e.attributes || []))
              if (a.key === '_contract_address') out[a.value] = 1;
  for (const c of (await txCandidates(addr).catch(() => []))) out[c] = 1;
  const list = Object.keys(out);
  cacheSet('nftc:' + addr, list);
  return list;
}

async function idsOf(c, addr){
  const ids = [];
  let after = null;
  while (ids.length < MAX_IDS) {
    const q = { tokens: { owner: addr, limit: 100 } };
    if (after !== null) q.tokens.start_after = after;
    const r = await smart(c, q, 1);
    const page = ((r && r.data) || {}).tokens || [];
    ids.push(...page);
    if (page.length < 100) break;
    after = page[page.length - 1];
  }
  return ids;
}

async function collections(addr){
  // contracts known not to be collections are skipped without a question
  const cands = (await contractsFor(addr)).filter(c => !permGet('nonft:' + c));
  const res = await mapLimit(cands, 6, async function (c) {
    let ids;
    try { ids = await idsOf(c, addr); }
    catch (e) { if (refused(e)) permSet('nonft:' + c, 1); return null; }
    if (!ids.length) return null;
    let name = permGet('nftname:' + c);
    if (name === undefined) {
      try { name = (((await smart(c, { contract_info: {} }, 1)).data) || {}).name || ''; permSet('nftname:' + c, name); }
      catch (e) { name = ''; }
    }
    return { c: c, name: name || 'Collection', ids: ids };
  });
  return res.filter(Boolean).sort((a, b) => b.ids.length - a.ids.length);
}

/* ---------------- pictures ---------------- */
const GATEWAYS = ['https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/'];
const web = (u, g) => !u ? '' : (String(u).indexOf('ipfs://') === 0 ? GATEWAYS[g || 0] + String(u).slice(7).replace(/^ipfs\//, '') : u);
const looksImage = u => /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(u || '');

// everything a card and its detail need, read once and kept
async function infoOf(c, id){
  const key = 'nfti:' + c + ':' + id;
  const kept = permGet(key);
  if (kept) return kept;
  let d;
  try { d = ((await smart(c, { nft_info: { token_id: String(id) } }, 1)).data) || {}; }
  catch (e) { return null; }
  const ext = d.extension || {};
  let meta = {};
  let img = ext.image || ext.image_url || '';
  if (!img && d.token_uri) {
    const uri = web(d.token_uri);
    if (looksImage(uri)) img = uri;
    else {
      try { meta = await getJSON(uri, 12000, 1) || {}; img = meta.image || meta.image_url || ''; }
      catch (e) { /* metadata unreachable: the card keeps its placeholder */ }
    }
  }
  const out = {
    img: img,
    name: ext.name || meta.name || '',
    desc: String(ext.description || meta.description || '').slice(0, 400),
    traits: (ext.attributes || meta.attributes || []).slice(0, 24).map(a => ({ k: String(a.trait_type || a.key || ''), v: String(a.value) }))
  };
  if (img) permSet(key, out);
  return out;
}

// pictures load as their cards come into view, four at a time
const QUEUE = [];
let RUNNING = 0;
function pump(){
  while (RUNNING < 4 && QUEUE.length) {
    const job = QUEUE.shift();
    RUNNING++;
    infoOf(job.c, job.id).then(function (info) {
      if (info) paint(job.el, info);
    }).finally(function () { RUNNING--; pump(); });
  }
}
function paint(card, info){
  const art = card.querySelector('.nft-art');
  if (info.name) card.querySelector('.nft-id').textContent = info.name;
  if (!info.img || !art) return;
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  let g = 0;
  img.onload = function () { art.innerHTML = ''; art.appendChild(img); art.classList.add('ok'); };
  // a slow or dead gateway: the second one, then the placeholder stays
  img.onerror = function () { if (String(info.img).indexOf('ipfs://') === 0 && g < GATEWAYS.length - 1) img.src = web(info.img, ++g); };
  img.src = web(info.img, 0);
}
const seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
  entries.forEach(function (en) {
    if (!en.isIntersecting) return;
    seen.unobserve(en.target);
    QUEUE.push({ el: en.target, c: en.target.dataset.c, id: en.target.dataset.id });
  });
  pump();
}, { rootMargin: '200px' }) : null;

/* ---------------- drawing ---------------- */
function card(c, id){
  return '<button type="button" class="nft-card" data-c="' + esc(c) + '" data-id="' + esc(id) + '">' +
    '<div class="nft-art"><span class="ph"></span></div>' +
    '<div class="nft-meta"><div class="nft-id">#' + esc(String(id).slice(0, 24)) + '</div></div></button>';
}

function draw(){
  const grid = $('#nft-grid'), note = $('#nft-note');
  const total = COLS.reduce((a, c) => a + c.ids.length, 0);
  $('#nft-count').textContent = total ? String(total) : '';
  if (!COLS.length) {
    grid.innerHTML = BUSY ? skeleton() : '<div class="nft-empty">No NFTs on this address yet.</div>';
    note.textContent = '';
    return;
  }
  grid.innerHTML = COLS.map(function (col) {
    const open = OPEN[col.c];
    const ids = open ? col.ids : col.ids.slice(0, PREVIEW);
    return '<section class="nft-col-sec">' +
      '<div class="nft-col-head"><b>' + esc(col.name) + '</b><span>' + col.ids.length + '</span>' +
        (col.ids.length > PREVIEW ? '<button type="button" class="nft-more" data-open="' + esc(col.c) + '">' + (open ? 'Show less' : 'See all') + '</button>' : '') +
      '</div><div class="nft-cards">' + ids.map(id => card(col.c, id)).join('') + '</div></section>';
  }).join('');
  note.textContent = total + ' NFT' + (total === 1 ? '' : 's') + ' in ' + COLS.length + ' collection' + (COLS.length === 1 ? '' : 's') +
    (BUSY ? ' \u00b7 checking for more\u2026' : '');
  grid.querySelectorAll('.nft-card').forEach(function (el) {
    const kept = permGet('nfti:' + el.dataset.c + ':' + el.dataset.id);
    if (kept) paint(el, kept);
    else if (seen) seen.observe(el);
    else QUEUE.push({ el: el, c: el.dataset.c, id: el.dataset.id });
  });
  pump();
}

const skeleton = () => Array.from({ length: 4 }, () =>
  '<div class="nft-card sk"><div class="nft-art"></div><div class="nft-meta"><div class="nft-line"></div></div></div>').join('');

async function load(force){
  const addr = me();
  if (!addr || BUSY || (!force && LOADED === addr)) return;
  BUSY = true;
  // last time's collections first, so the tab is never a blank wait
  const kept = cacheGet('nftcol:' + addr);
  COLS = Array.isArray(kept) ? kept : [];
  if (!COLS.length) $('#nft-grid').innerHTML = '<div class="nft-cards">' + skeleton() + '</div>';
  else draw();
  try {
    const fresh = await collections(addr);
    if (addr !== me()) return;
    COLS = fresh;
    cacheSet('nftcol:' + addr, fresh);
    LOADED = addr;
  } catch (e) {
    if (!COLS.length) { $('#nft-grid').innerHTML = '<div class="nft-empty">Could not read the chain just now.</div>'; BUSY = false; return; }
  }
  BUSY = false;
  draw();
}

/* ---------------- one NFT ---------------- */
async function openNft(c, id){
  const col = COLS.filter(x => x.c === c)[0];
  const sheet = $('#nft-sheet'), body = $('#nft-body');
  body.innerHTML = '<div class="nft-big sk"></div><div class="tk-skel"></div><div class="tk-skel"></div>';
  sheet.hidden = false;
  document.body.classList.add('nft-lock');
  const info = await infoOf(c, id) || {};
  const big = info.img ? '<img src="' + esc(web(info.img)) + '" alt="">' : '<span class="ph"></span>';
  body.innerHTML =
    '<div class="nft-big">' + big + '</div>' +
    '<div class="nft-info">' +
      '<div class="nft-chip">' + esc(col ? col.name : 'Collection') + '</div>' +
      '<h3 class="nft-title">' + esc(info.name || '#' + id) + '</h3>' +
      '<div class="nft-sub">Token ID ' + esc(String(id).slice(0, 40)) + '</div>' +
      (info.desc ? '<p class="nft-desc">' + esc(info.desc) + '</p>' : '') +
      (info.traits && info.traits.length ? '<div class="nft-traits-h">Traits</div><div class="nft-traits">' + info.traits.map(t =>
        '<div><span>' + esc(t.k) + '</span><b>' + esc(t.v) + '</b></div>').join('') + '</div>' : '') +
      '<button type="button" class="btn quiet nft-link" data-url="' + FINDER + esc(c) + '">View collection in explorer</button>' +
    '</div>';
  const img = body.querySelector('.nft-big img');
  if (img) img.onerror = function () { if (String(info.img).indexOf('ipfs://') === 0) this.src = web(info.img, 1); };
}

function pane(which){
  const tok = which === 'tok';
  document.querySelectorAll('.hm-seg-b').forEach(b => b.classList.toggle('on', b.dataset.pane === which));
  $('#pane-tok').hidden = !tok;
  $('#pane-nft').hidden = tok;
  if (!tok) load();
}

document.querySelectorAll('.hm-seg-b').forEach(b => b.addEventListener('click', () => pane(b.dataset.pane)));
$('#nft-grid').addEventListener('click', function (e) {
  const m = e.target.closest('[data-open]');
  if (m) { tap(); OPEN[m.dataset.open] = !OPEN[m.dataset.open]; draw(); return; }
  const c = e.target.closest('.nft-card[data-c]');
  if (c) { tap(); openNft(c.dataset.c, c.dataset.id); }
});
const closeSheet = () => { $('#nft-sheet').hidden = true; document.body.classList.remove('nft-lock'); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#nft-sheet').hidden) closeSheet(); });
$('#nft-x').addEventListener('click', closeSheet);
$('#nft-sheet').addEventListener('click', function (e) {
  if (e.target === this || e.target.classList.contains('nft-view-in')) { closeSheet(); return; }
  const l = e.target.closest('[data-url]');
  if (l) {
    if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openLink) Telegram.WebApp.openLink(l.dataset.url);
    else window.open(l.dataset.url, '_blank', 'noopener');
  }
});
// a pull or the refresh button reads again what is on screen
document.addEventListener('frontier:refresh', function () {
  if (!$('#pane-nft').hidden) { cacheSet('nftc:' + me(), null); load(true); }
});
document.addEventListener('frontier:wallet', function () { LOADED = ''; COLS = []; OPEN = {}; });

export { load };
