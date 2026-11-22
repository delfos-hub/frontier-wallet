// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=e508b1b8';
import './onboarding.js?v=e508b1b8';
import './crypto.js?v=e508b1b8';
import './chain.js?v=e508b1b8';
import './market.js?v=e508b1b8';
import './tokens.js?v=e508b1b8';
import './tx.js?v=e508b1b8';
import './storage.js?v=e508b1b8';
import './boot.js?v=e508b1b8';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=e508b1b8';
// a sideways swipe moves between the five tabs
import './swipe.js?v=e508b1b8';
// Core assets: market, stake and peg next to the balances
import './core.js?v=e508b1b8';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=e508b1b8';
