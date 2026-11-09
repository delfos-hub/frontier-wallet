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
    foot = document.createElement('div');
    foot.className = 'dk-foot';
    foot.innerHTML = '<b>FRONTIER WEB</b>Non-custodial. Your keys stay in this browser.';
    tabs.append(foot);
  }
  if (!on) { if (logo) logo.remove(); if (foot) foot.remove(); }
}

function apply(){
  const on = WIDE.matches;
  document.documentElement.classList.toggle('dk', on);
  rail(on);
  if (on) split(); else join();
}
WIDE.addEventListener('change', apply);
apply();
