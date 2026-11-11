/* scene.js - the room behind every screen.

   A fixed 3D scene sits under the screens: a floor and a ceiling grid that
   meet at a lit horizon, dust far away and two glows close by, like standing
   in a compartment of a ship. It follows the phone in the hand: tilt it and
   the room turns and the near layers drift the same way, the far ones less,
   which is what gives the depth. Each screen is its own room with its own
   light, and going from one to another is a move between compartments: the
   floor runs forward and the new screen arrives out of the depth (to the
   side, for the tabs next to each other). Only transforms and opacity move,
   so the GPU carries it and the frame rate holds.

   Motion source, best first: Telegram's DeviceOrientation (Bot API 8.0, no
   browser permission prompt), the browser's deviceorientation, and on a
   desktop the pointer. Nothing moves with "reduce motion" switched on. */
import { tg } from './shell.js?v=3875134b';

const STILL = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const TABS = ['home', 'stake', 'gov', 'activity', 'settings'];
// the light of each room: [main, second]
const ROOM = {
  welcome: ['#7B5CFF', '#00D4FF'], unlock: ['#7B5CFF', '#00D4FF'], setup: ['#7B5CFF', '#00D4FF'],
  home: ['#7B5CFF', '#00D4FF'], stake: ['#3ECF8E', '#00D4FF'], gov: ['#B04AE8', '#7B5CFF'],
  activity: ['#00D4FF', '#3B82F6'], settings: ['#3B82F6', '#7B5CFF'], swap: ['#00D4FF', '#7B5CFF'],
  send: ['#E8C840', '#7B5CFF'], receive: ['#3ECF8E', '#7B5CFF'], p2p: ['#00D4FF', '#3ECF8E'],
  gram: ['#2AA1FF', '#E8C840'], earn: ['#3ECF8E', '#7B5CFF'], token: ['#7B5CFF', '#00D4FF']
};

const scene = document.createElement('div');
scene.id = 'fw-scene';
scene.setAttribute('aria-hidden', 'true');
scene.innerHTML =
  '<div class="sc-far"></div>' +
  '<div class="sc-room"><div class="sc-ceil"></div><div class="sc-floor"></div></div>' +
  '<div class="sc-fog"></div><div class="sc-hz"></div>' +
  '<div class="sc-glow a"></div><div class="sc-glow b"></div>';
document.body.insertBefore(scene, document.body.firstChild);
document.body.classList.add('has-scene');

/* ---------- tilt ---------- */
let tx = 0, ty = 0;          // where the hand is, -1..1
let cx = 0, cy = 0;          // where the scene is
let base = null;             // the angle the phone is held at, slowly following
let raf = 0;

function feed(beta, gamma){
  if (beta == null || gamma == null) return;
  if (!base) base = { b: beta, g: gamma };
  // the resting angle drifts toward how the phone is held now, so holding it
  // still at any angle brings the room back to the middle
  base.b += (beta - base.b) * 0.015;
  base.g += (gamma - base.g) * 0.015;
  tx = Math.max(-1, Math.min(1, (gamma - base.g) / 18));
  ty = Math.max(-1, Math.min(1, (beta - base.b) / 18));
  kick();
}
function kick(){ if (!raf) raf = requestAnimationFrame(frame); }
function frame(){
  raf = 0;
  cx += (tx - cx) * 0.09;
  cy += (ty - cy) * 0.09;
  scene.style.setProperty('--tx', cx.toFixed(4));
  scene.style.setProperty('--ty', cy.toFixed(4));
  if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) kick();
}

function startMotion(){
  if (STILL) return;
  const T = tg;
  if (T && T.DeviceOrientation && T.isVersionAtLeast && T.isVersionAtLeast('8.0')) {
    try {
      T.onEvent('deviceOrientationChanged', () => feed(T.DeviceOrientation.beta * 57.2958, T.DeviceOrientation.gamma * 57.2958));
      T.DeviceOrientation.start({ refresh_rate: 40 });
      document.addEventListener('visibilitychange', () => {
        try { document.hidden ? T.DeviceOrientation.stop() : T.DeviceOrientation.start({ refresh_rate: 40 }); } catch (e) {}
      });
      return;
    } catch (e) {}
  }
  if ('DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    window.addEventListener('deviceorientation', e => feed(e.beta, e.gamma));
  }
  // a desktop window: the pointer stands in for the hand
  if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', e => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
      kick();
    }, { passive: true });
  }
}

/* ---------- rooms ---------- */
let current = null;
// go() scrolls to the top before anything here runs, so the scroll the old
// screen was at is kept from the last scroll event
let lastY = 0;
window.addEventListener('scroll', () => { lastY = window.scrollY; }, { passive: true });
function roomOf(step){ return step && step.id ? step.id.replace(/^st-/, '') : null; }

function enter(step){
  const name = roomOf(step);
  if (!name || name === current) return;
  const prev = current;
  current = name;
  const c = ROOM[name] || ROOM.home;
  // the new light: straight away on the first screen, otherwise while the
  // glows are faded out, so no gradient is ever repainted in view
  const light = () => { scene.style.setProperty('--sc-a', c[0]); scene.style.setProperty('--sc-b', c[1]); };
  if (!prev || STILL) light();
  else {
    scene.classList.add('sc-dim');
    clearTimeout(scene._lightT);
    scene._lightT = setTimeout(() => { light(); scene.classList.remove('sc-dim'); }, 210);
  }
  if (STILL || !prev || document.body.classList.contains('fw-enter')) return;
  // which way: the tabs sit side by side; anything else is a door further in,
  // and coming back to a tab is a step back out
  const a = TABS.indexOf(prev), b = TABS.indexOf(name);
  const dir = a >= 0 && b >= 0 ? (b > a ? 'right' : 'left') : b < 0 ? 'in' : 'out';
  step.classList.remove('room-right', 'room-left', 'room-in', 'room-out');
  // back to a screen that is still leaving (two taps within half a second):
  // its leave state would keep it pinned and untouchable until the timer ran
  clearTimeout(step._leaveT);
  step.classList.remove('leave-right', 'leave-left', 'leave-in', 'leave-out');
  scene.classList.remove('sc-move', 'sc-back');
  void scene.offsetWidth;                    // restart, even for the same direction twice
  // The old screen stays on for the move and leaves the other way, so the two
  // pass each other instead of one blinking out. It is pinned where it was
  // scrolled, and starts from wherever a swipe left it.
  const old = document.getElementById('st-' + prev);
  if (old && old !== step) {
    clearTimeout(old._leaveT);
    old.classList.remove('leave-right', 'leave-left', 'leave-in', 'leave-out');
    const drag = old.style.transform || '';
    const m = /translate3d\((-?[\d.]+)px/.exec(drag);
    old.style.setProperty('--drag', (m ? m[1] : '0') + 'px');
    old.style.setProperty('--ly', lastY + 'px');
    old.style.transform = '';
    old.style.transition = '';
    old.classList.add('leave-' + dir);
    old._leaveT = setTimeout(() => old.classList.remove('leave-' + dir), 460);
  }
  step.classList.add('room-' + dir);
  scene.classList.add(dir === 'out' ? 'sc-back' : 'sc-move');
  clearTimeout(step._roomT);
  step._roomT = setTimeout(() => { step.classList.remove('room-' + dir); scene.classList.remove('sc-move', 'sc-back'); }, 520);
}

const steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
const mo = new MutationObserver(list => {
  for (const m of list) if (m.target.classList.contains('on')) enter(m.target);
});
steps.forEach(s => mo.observe(s, { attributes: true, attributeFilter: ['class'] }));
enter(steps.filter(s => s.classList.contains('on'))[0]);
startMotion();
