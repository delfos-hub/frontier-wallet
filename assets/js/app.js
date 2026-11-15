// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=39f0ac1d';
import './onboarding.js?v=39f0ac1d';
import './crypto.js?v=39f0ac1d';
import './chain.js?v=39f0ac1d';
import './market.js?v=39f0ac1d';
import './tokens.js?v=39f0ac1d';
import './tx.js?v=39f0ac1d';
import './storage.js?v=39f0ac1d';
import './boot.js?v=39f0ac1d';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=39f0ac1d';
// a sideways swipe moves between the five tabs
import './swipe.js?v=39f0ac1d';
// Core assets: market, stake and peg next to the balances
import './core.js?v=39f0ac1d';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=39f0ac1d';
