/* Wrong PINs, counted across reloads.

   The PIN is short, so each guess at the unlock screen (and at the sheet that
   shows the recovery phrase) is made to cost time: after 5 wrong ones in a row
   the next waits 30 s, then twice as long after each further miss, up to 15
   minutes. The count is kept in localStorage, so reloading the page does not
   reset it; a right PIN does. This slows guessing on the device; it does not
   protect a copied blob, which is the separate question of the PIN scheme. */
const KEY = 'fw:pin:fails';
const FREE = 5, FIRST = 30000, MAX = 15 * 60000;

function read(){
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (r && Number.isInteger(r.n) && r.n >= 0 && typeof r.until === 'number') return r;
  } catch (e) {}
  return { n: 0, until: 0 };
}
function write(r){ try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {} }

// ms until the next try is allowed (0: now)
function pinWait(now = Date.now()){
  return Math.max(0, read().until - now);
}
function pinFail(now = Date.now()){
  const r = read();
  r.n += 1;
  r.until = r.n >= FREE ? now + Math.min(MAX, FIRST * Math.pow(2, r.n - FREE)) : 0;
  write(r);
  return r;
}
function pinOk(){ write({ n: 0, until: 0 }); }
// "30 s", "2 min"
function waitText(ms){
  const s = Math.ceil(ms / 1000);
  return s < 60 ? s + ' s' : Math.ceil(s / 60) + ' min';
}

export { pinFail, pinOk, pinWait, waitText };
