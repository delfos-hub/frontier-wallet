// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=d4ca4f59';
import './onboarding.js?v=d4ca4f59';
import './crypto.js?v=d4ca4f59';
import './chain.js?v=d4ca4f59';
import './market.js?v=d4ca4f59';
import './tokens.js?v=d4ca4f59';
import './tx.js?v=d4ca4f59';
import './storage.js?v=d4ca4f59';
import './boot.js?v=d4ca4f59';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=d4ca4f59';
// a sideways swipe moves between the five tabs
import './swipe.js?v=d4ca4f59';
// Core assets: market, stake and peg next to the balances
import './core.js?v=d4ca4f59';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=d4ca4f59';
