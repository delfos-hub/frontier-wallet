// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=1f2425a3';
import './onboarding.js?v=1f2425a3';
import './crypto.js?v=1f2425a3';
import './chain.js?v=1f2425a3';
import './market.js?v=1f2425a3';
import './tokens.js?v=1f2425a3';
import './tx.js?v=1f2425a3';
import './storage.js?v=1f2425a3';
import './boot.js?v=1f2425a3';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=1f2425a3';
// a sideways swipe moves between the five tabs
import './swipe.js?v=1f2425a3';
// Core assets: market, stake and peg next to the balances
import './core.js?v=1f2425a3';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=1f2425a3';
