// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=62373f3f';
import './onboarding.js?v=62373f3f';
import './crypto.js?v=62373f3f';
import './chain.js?v=62373f3f';
import './market.js?v=62373f3f';
import './tokens.js?v=62373f3f';
import './tx.js?v=62373f3f';
import './storage.js?v=62373f3f';
import './boot.js?v=62373f3f';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=62373f3f';
// a sideways swipe moves between the five tabs
import './swipe.js?v=62373f3f';
// Core assets: market, stake and peg next to the balances
import './core.js?v=62373f3f';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=62373f3f';
