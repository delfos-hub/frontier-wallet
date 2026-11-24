// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=2f0876f8';
import './onboarding.js?v=2f0876f8';
import './crypto.js?v=2f0876f8';
import './chain.js?v=2f0876f8';
import './market.js?v=2f0876f8';
import './tokens.js?v=2f0876f8';
import './tx.js?v=2f0876f8';
import './storage.js?v=2f0876f8';
import './boot.js?v=2f0876f8';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=2f0876f8';
// a sideways swipe moves between the five tabs
import './swipe.js?v=2f0876f8';
// Core assets: market, stake and peg next to the balances
import './core.js?v=2f0876f8';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=2f0876f8';
