// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=30db946b';
import './onboarding.js?v=30db946b';
import './crypto.js?v=30db946b';
import './chain.js?v=30db946b';
import './market.js?v=30db946b';
import './tokens.js?v=30db946b';
import './tx.js?v=30db946b';
import './storage.js?v=30db946b';
import './boot.js?v=30db946b';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=30db946b';
// a sideways swipe moves between the five tabs
import './swipe.js?v=30db946b';
// Core assets: market, stake and peg next to the balances
import './core.js?v=30db946b';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=30db946b';
