// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=5d689f3a';
import './onboarding.js?v=5d689f3a';
import './crypto.js?v=5d689f3a';
import './chain.js?v=5d689f3a';
import './market.js?v=5d689f3a';
import './tokens.js?v=5d689f3a';
import './tx.js?v=5d689f3a';
import './storage.js?v=5d689f3a';
import './boot.js?v=5d689f3a';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=5d689f3a';
// a sideways swipe moves between the five tabs
import './swipe.js?v=5d689f3a';
// Core assets: market, stake and peg next to the balances
import './core.js?v=5d689f3a';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=5d689f3a';
