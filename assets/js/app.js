// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=f4cf6336';
import './onboarding.js?v=f4cf6336';
import './crypto.js?v=f4cf6336';
import './chain.js?v=f4cf6336';
import './market.js?v=f4cf6336';
import './tokens.js?v=f4cf6336';
import './tx.js?v=f4cf6336';
import './storage.js?v=f4cf6336';
import './boot.js?v=f4cf6336';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=f4cf6336';
// a sideways swipe moves between the five tabs
import './swipe.js?v=f4cf6336';
// Core assets: market, stake and peg next to the balances
import './core.js?v=f4cf6336';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=f4cf6336';
