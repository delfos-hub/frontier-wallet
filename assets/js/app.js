// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=d55e7470';
import './onboarding.js?v=d55e7470';
import './crypto.js?v=d55e7470';
import './chain.js?v=d55e7470';
import './market.js?v=d55e7470';
import './tokens.js?v=d55e7470';
import './tx.js?v=d55e7470';
import './storage.js?v=d55e7470';
import './boot.js?v=d55e7470';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=d55e7470';
// a sideways swipe moves between the five tabs
import './swipe.js?v=d55e7470';
// Core assets: market, stake and peg next to the balances
import './core.js?v=d55e7470';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=d55e7470';
