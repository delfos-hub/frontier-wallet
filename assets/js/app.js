// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=bb415887';
import './onboarding.js?v=bb415887';
import './crypto.js?v=bb415887';
import './chain.js?v=bb415887';
import './market.js?v=bb415887';
import './tokens.js?v=bb415887';
import './tx.js?v=bb415887';
import './storage.js?v=bb415887';
import './boot.js?v=bb415887';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=bb415887';
// a sideways swipe moves between the five tabs
import './swipe.js?v=bb415887';
// Core assets: market, stake and peg next to the balances
import './core.js?v=bb415887';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=bb415887';
