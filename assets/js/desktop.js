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
    bal.innerHTML = '<div class="dk-bal-l">Total balance</div><div class="dk-bal-v"></div><div class="dk-bal-s"></div>';
    bal.addEventListener('click', () => { const r = document.getElementById('bal-refresh'); if (r) r.click(); });
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
  box.querySelector('.dk-bal-v').textContent = total ? total.textContent : '';
  const s = box.querySelector('.dk-bal-s');
  s.innerHTML = split && !split.hidden ? split.innerHTML : '';
}
['bal-total', 'bal-split'].forEach(id => {
  const el = document.getElementById(id);
  if (el) new MutationObserver(mirror).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
});

function apply(){
  const on = WIDE.matches;
  document.documentElement.classList.toggle('dk', on);
  rail(on);
  if (on) split(); else join();
}
WIDE.addEventListener('change', apply);
apply();
