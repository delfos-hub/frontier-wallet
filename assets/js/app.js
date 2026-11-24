// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=e045e388';
import './onboarding.js?v=e045e388';
import './crypto.js?v=e045e388';
import './chain.js?v=e045e388';
import './market.js?v=e045e388';
import './tokens.js?v=e045e388';
import './tx.js?v=e045e388';
import './storage.js?v=e045e388';
import './boot.js?v=e045e388';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=e045e388';
// a sideways swipe moves between the five tabs
import './swipe.js?v=e045e388';
// Core assets: market, stake and peg next to the balances
import './core.js?v=e045e388';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=e045e388';
