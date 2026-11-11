// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=24e1f01b';
import './onboarding.js?v=24e1f01b';
import './crypto.js?v=24e1f01b';
import './chain.js?v=24e1f01b';
import './market.js?v=24e1f01b';
import './tokens.js?v=24e1f01b';
import './tx.js?v=24e1f01b';
import './storage.js?v=24e1f01b';
import './boot.js?v=24e1f01b';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=24e1f01b';
// a sideways swipe moves between the five tabs
import './swipe.js?v=24e1f01b';
// Core assets: market, stake and peg next to the balances
import './core.js?v=24e1f01b';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=24e1f01b';
