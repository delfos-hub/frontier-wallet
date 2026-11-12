/* Frontier Web on a wide screen: marks the page `dk` (desktop.css does the
   rest), puts the wordmark at the top of the side rail, and splits Home into
   two columns. Narrow again (a window made smaller), and everything goes
   back exactly where it was, so the phone layout is never touched. */
const WIDE = window.matchMedia('(min-width: 1100px)');
const home = document.getElementById('st-home');
const tabs = document.getElementById('tabs');
const LEFT = ['.bal', '.acts', '#txq', '#xc-gram', '#usdc-sunset', '.head', '#core'];
const RIGHT = ['#earn-open', '#ads', '#hm-seg', '#pane-tok', '#pane-nft'];
let order = null;     // Home's children before the split, to put them back

function pick(sel){
  return [...home.children].find(el => el.matches(sel) && !el.classList.contains('dk-home')) ||
         (home.querySelector('.dk-home ' + sel) || null);
}

function split(){
  if (!home || home.querySelector(':scope > .dk-home')) return;
  order = [...home.children];
  const wrap = document.createElement('div'); wrap.className = 'dk-home';
  const a = document.createElement('div'); a.className = 'dk-a';
  const b = document.createElement('div'); b.className = 'dk-b';
  wrap.append(a, b);
  const top = home.querySelector(':scope > .wtop');
  if (top) top.after(wrap); else home.prepend(wrap);
  LEFT.forEach(s => { const el = pick(s); if (el) a.append(el); });
  RIGHT.forEach(s => { const el = pick(s); if (el) b.append(el); });
}

function join(){
  const wrap = home && home.querySelector(':scope > .dk-home');
  if (!wrap || !order) return;
  order.forEach(el => home.append(el));
  wrap.remove();
  order = null;
}

function rail(on){
  if (!tabs) return;
  let logo = tabs.querySelector('.dk-logo'), foot = tabs.querySelector('.dk-foot');
  if (on && !logo) {
    logo = document.createElement('img');
    logo.className = 'dk-logo'; logo.alt = 'Frontier'; logo.src = 'assets/frontier-wordmark.png';
    tabs.prepend(logo);
    // the balance under the wordmark (Nans): a mirror of Home's own figures,
    // which the wallet keeps up to date; a click refreshes, like Home's button
    const bal = document.createElement('div');
    bal.className = 'dk-bal'; bal.title = 'Refresh';
    bal.tabIndex = 0; bal.setAttribute('role', 'button');
    bal.innerHTML = '<div class="dk-bal-l"><span>Total balance</span><span class="dk-bal-upd" aria-hidden="true">Updated</span></div><div class="dk-bal-v"></div><div class="dk-bal-s"></div>';
    bal.addEventListener('click', () => { const r = document.getElementById('bal-refresh'); if (r) r.click(); });
    bal.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bal.click(); } });
    logo.after(bal);
    mirror();
    foot = document.createElement('div');
    foot.className = 'dk-foot';
    foot.innerHTML = '<b>FRONTIER WEB</b>Non-custodial. Your keys stay in this browser.';
    tabs.append(foot);
  }
  if (!on) { if (logo) logo.remove(); if (foot) foot.remove(); const b = tabs.querySelector('.dk-bal'); if (b) b.remove(); }
}

// Home's total and its wallet / DeFi split, copied into the rail whenever
// the wallet changes them
function mirror(){
  const box = tabs && tabs.querySelector('.dk-bal');
  if (!box) return;
  const total = document.getElementById('bal-total'), split = document.getElementById('bal-split');
  const v = box.querySelector('.dk-bal-v');
  v.textContent = total ? total.textContent : '';
  // dimmed while the figure is still loading, as Home's own is (Pablo)
  v.classList.toggle('stale', !!(total && total.classList.contains('stale')));
  const upd = document.getElementById('bal-upd'), u = box.querySelector('.dk-bal-upd');
  if (u) {
    const on = !!(upd && upd.classList.contains('on'));
    u.classList.toggle('on', on);
    u.setAttribute('aria-hidden', on ? 'false' : 'true');   // read only while it is shown (CodeRabbit)
  }
  const s = box.querySelector('.dk-bal-s');
  s.innerHTML = split && !split.hidden ? split.innerHTML : '';
}
['bal-total', 'bal-split', 'bal-upd'].forEach(id => {
  const el = document.getElementById(id);
  if (el) new MutationObserver(mirror).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
});

function apply(){
  const on = WIDE.matches;
  document.documentElement.classList.toggle('dk', on);
  rail(on);
  if (on) split(); else join();
}
WIDE.addEventListener('change', apply);
apply();

/* Stake and Vote on a wide screen, like Home: two columns. The left one
   holds what is mine (the stake ring, its tiles and actions; my voting power
   and what is being voted now) and stays in view; the right one holds the
   lists (validators, unstaking; recent proposals). Each screen draws its body
   again on every refresh, so the columns are made again after each drawing.
   Narrower than 1100 px, the body is put back as it was drawn. */
const SPLITS = {
  'stk-body': { left: el => el.matches('.stk-hero, .stk-bigacts, .stk-steps') },
  // everything before the "Recent" heading is the left column
  'gov-body': { rightFrom: el => el.classList.contains('head') && !!el.nextElementSibling && el.nextElementSibling.classList.contains('gv-recent') },
};
function unsplit(box){
  const cur = box.querySelector(':scope > .dk-split');
  if (!cur) return;
  [...cur.querySelector('.dk-l').children, ...cur.querySelector('.dk-r').children].forEach(c => box.insertBefore(c, cur));
  cur.remove();
}
function resplit(id){
  const box = document.getElementById(id);
  if (!box) return;
  if (!WIDE.matches) { unsplit(box); return; }
  const kids = [...box.children];
  if (kids.length === 1 && kids[0].classList.contains('dk-split')) return;     // already in columns
  // Decide both columns before anything moves (Pablo, #53): when one of them
  // would be empty (no "Recent" heading, a failed request), nothing is
  // touched, so the observer sees no change and does not run again.
  const cur = box.querySelector(':scope > .dk-split');
  const all = cur ? [...cur.querySelector('.dk-l').children, ...cur.querySelector('.dk-r').children, ...kids.filter(k => k !== cur)] : kids;
  const rule = SPLITS[id];
  const left = [], right = [];
  let toRight = false;
  for (const k of all) {
    if (rule.rightFrom) { if (!toRight && rule.rightFrom(k)) toRight = true; (toRight ? right : left).push(k); }
    else (rule.left(k) ? left : right).push(k);
  }
  if (!left.length || !right.length) { if (cur) unsplit(box); return; }        // as drawn
  const wrap = document.createElement('div'); wrap.className = 'dk-split';
  const l = document.createElement('div'); l.className = 'dk-l';
  const r = document.createElement('div'); r.className = 'dk-r';
  l.append(...left); r.append(...right);
  wrap.append(l, r);
  box.append(wrap);
  if (cur) cur.remove();
}
Object.keys(SPLITS).forEach(id => {
  const box = document.getElementById(id);
  if (box) new MutationObserver(() => resplit(id)).observe(box, { childList: true });
});
WIDE.addEventListener('change', () => Object.keys(SPLITS).forEach(resplit));
Object.keys(SPLITS).forEach(resplit);
