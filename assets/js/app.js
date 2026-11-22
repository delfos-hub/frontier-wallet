// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=d7966255';
import './onboarding.js?v=d7966255';
import './crypto.js?v=d7966255';
import './chain.js?v=d7966255';
import './market.js?v=d7966255';
import './tokens.js?v=d7966255';
import './tx.js?v=d7966255';
import './storage.js?v=d7966255';
import './boot.js?v=d7966255';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=d7966255';
// a sideways swipe moves between the five tabs
import './swipe.js?v=d7966255';
// Core assets: market, stake and peg next to the balances
import './core.js?v=d7966255';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=d7966255';
