// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=fc4290fc';
import './onboarding.js?v=fc4290fc';
import './crypto.js?v=fc4290fc';
import './chain.js?v=fc4290fc';
import './market.js?v=fc4290fc';
import './tokens.js?v=fc4290fc';
import './tx.js?v=fc4290fc';
import './storage.js?v=fc4290fc';
import './boot.js?v=fc4290fc';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=fc4290fc';
// a sideways swipe moves between the five tabs
import './swipe.js?v=fc4290fc';
// Core assets: market, stake and peg next to the balances
import './core.js?v=fc4290fc';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=fc4290fc';
