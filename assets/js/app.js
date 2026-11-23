// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=594deaf9';
import './onboarding.js?v=594deaf9';
import './crypto.js?v=594deaf9';
import './chain.js?v=594deaf9';
import './market.js?v=594deaf9';
import './tokens.js?v=594deaf9';
import './tx.js?v=594deaf9';
import './storage.js?v=594deaf9';
import './boot.js?v=594deaf9';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=594deaf9';
// a sideways swipe moves between the five tabs
import './swipe.js?v=594deaf9';
// Core assets: market, stake and peg next to the balances
import './core.js?v=594deaf9';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=594deaf9';
