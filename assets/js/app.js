// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=12072d06';
import './onboarding.js?v=12072d06';
import './crypto.js?v=12072d06';
import './chain.js?v=12072d06';
import './market.js?v=12072d06';
import './tokens.js?v=12072d06';
import './tx.js?v=12072d06';
import './storage.js?v=12072d06';
import './boot.js?v=12072d06';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=12072d06';
// a sideways swipe moves between the five tabs
import './swipe.js?v=12072d06';
// Core assets: market, stake and peg next to the balances
import './core.js?v=12072d06';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=12072d06';
