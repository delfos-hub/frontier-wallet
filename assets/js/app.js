// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=d1e8b95c';
import './onboarding.js?v=d1e8b95c';
import './crypto.js?v=d1e8b95c';
import './chain.js?v=d1e8b95c';
import './market.js?v=d1e8b95c';
import './tokens.js?v=d1e8b95c';
import './tx.js?v=d1e8b95c';
import './storage.js?v=d1e8b95c';
import './boot.js?v=d1e8b95c';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=d1e8b95c';
// a sideways swipe moves between the five tabs
import './swipe.js?v=d1e8b95c';
// Core assets: market, stake and peg next to the balances
import './core.js?v=d1e8b95c';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=d1e8b95c';
