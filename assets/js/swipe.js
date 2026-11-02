/* swipe.js - a sideways swipe moves between the five tab screens
   (Home, Stake, Vote, Activity, Settings), and only between those.

   It stays out of the way of everything else that reads a sideways finger:
   the banner carousel, anything that scrolls sideways, text fields, an open
   sheet, and the screen edges (where iOS and Telegram have their own swipes).
   A swipe has to be clearly sideways and long enough; vertical scrolling is
   never held up, the listeners are passive. While the finger moves, the
   screen follows it and the light in the tab bar leans toward the next tab;
   let go far enough and the screen carries on out from where it is while the
   next one comes in, otherwise it eases back. */
const TABS = ['home', 'stake', 'gov', 'activity', 'settings'];
const EDGE = 24, MIN_DX = 64, RATIO = 1.6, MAX_MS = 700;
const STILL = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let s = null;   // { x, y, t, step, idx, live }

function current(){
  const st = document.querySelector('.step.on');
  if (!st) return null;
  const idx = TABS.indexOf(st.id.replace(/^st-/, ''));
  return idx < 0 ? null : { step: st, idx: idx };
}

function blocked(target){
  if (document.body.classList.contains('sheet-open')) return true;
  if (document.querySelector('.sw-sheet:not([hidden])')) return true;
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (el.id === 'ads' || el.hasAttribute('data-no-swipe')) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.scrollWidth > el.clientWidth + 2) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    if (el.classList && el.classList.contains('step')) break;
  }
  return false;
}

// the screen follows the finger, and the light in the tab bar moves toward
// the tab the finger is heading for
function follow(dx){
  if (STILL || !s) return;
  const atEnd = (dx > 0 && s.idx === 0) || (dx < 0 && s.idx === TABS.length - 1);
  const d = atEnd ? dx * 0.12 : dx * 0.45;
  s.step.style.transform = 'translate3d(' + Math.max(-140, Math.min(140, d)).toFixed(1) + 'px,0,0)';
  ind.lean(atEnd ? 0 : -dx / window.innerWidth);
}
function release(){
  ind.lean(0);
  if (s && s.step) {
    const st = s.step;
    st.style.transition = 'transform .32s cubic-bezier(.22,1,.36,1)';
    st.style.transform = '';
    setTimeout(() => { st.style.transition = ''; }, 340);
  }
}

/* the sliding light of the tab bar */
const ind = (function () {
  const bar = document.getElementById('tabs');
  if (!bar) return { lean: function () {} };
  const el = document.createElement('span');
  el.className = 'tab-ind';
  bar.appendChild(el);
  bar.classList.add('has-ind');
  let lean = 0;
  function place(){
    const sel = bar.querySelector('.tab.sel');
    if (!sel || !sel.offsetWidth) return;
    const step = sel.offsetWidth + 1;
    el.style.width = sel.offsetWidth + 'px';
    el.style.transform = 'translate3d(' + (sel.offsetLeft + lean * step).toFixed(1) + 'px,0,0)';
  }
  new MutationObserver(place).observe(bar, { attributes: true, subtree: true, attributeFilter: ['class'] });
  window.addEventListener('resize', place);
  requestAnimationFrame(place);
  return {
    lean: function (f) {
      lean = Math.max(-1, Math.min(1, f));
      bar.classList.toggle('dragging', f !== 0);
      place();
    }
  };
})();

document.addEventListener('touchstart', e => {
  s = null;
  if (e.touches.length !== 1) return;
  const c = current();
  if (!c) return;
  const t = e.touches[0];
  if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
  if (blocked(e.target)) return;
  s = { x: t.clientX, y: t.clientY, t: Date.now(), step: c.step, idx: c.idx, live: false, off: false };
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!s || s.off) return;
  const t = e.touches[0];
  const dx = t.clientX - s.x, dy = t.clientY - s.y;
  if (!s.live) {
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { s.off = true; return; }   // a scroll
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * RATIO) s.live = true;
    else return;
  }
  follow(dx);
}, { passive: true });

document.addEventListener('touchend', e => {
  if (!s) return;
  const g = s;
  const t = e.changedTouches[0];
  const dx = t.clientX - g.x, dy = t.clientY - g.y;
  // a quick flick, or a slow drag past a third of the screen
  const far = Math.abs(dx) > window.innerWidth * 0.33;
  const flick = Math.abs(dx) >= MIN_DX && Date.now() - g.t < MAX_MS;
  const ok = g.live && !g.off && (far || flick) && Math.abs(dx) > Math.abs(dy) * RATIO;
  const to = g.idx + (dx < 0 ? 1 : -1);
  if (ok && to >= 0 && to < TABS.length) {
    // the dragged screen keeps its offset: scene.js picks it up and carries
    // it on out from there, so nothing snaps back first
    lean0();
    const b = document.querySelector('.tab[data-tab="' + TABS[to] + '"]');
    if (b) b.click();                       // the same path as a tap on the tab
  } else release();
  s = null;
}, { passive: true });

function lean0(){ document.getElementById('tabs') && document.getElementById('tabs').classList.remove('dragging'); ind.lean(0); }

document.addEventListener('touchcancel', () => { release(); s = null; }, { passive: true });
