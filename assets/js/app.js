// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=3875134b';
import './onboarding.js?v=3875134b';
import './crypto.js?v=3875134b';
import './chain.js?v=3875134b';
import './market.js?v=3875134b';
import './tokens.js?v=3875134b';
import './tx.js?v=3875134b';
import './storage.js?v=3875134b';
import './boot.js?v=3875134b';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=3875134b';
// a sideways swipe moves between the five tabs
import './swipe.js?v=3875134b';
// Core assets: market, stake and peg next to the balances
import './core.js?v=3875134b';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=3875134b';
