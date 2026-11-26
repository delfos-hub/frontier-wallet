// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=bd5d7425';
import './onboarding.js?v=bd5d7425';
import './crypto.js?v=bd5d7425';
import './chain.js?v=bd5d7425';
import './market.js?v=bd5d7425';
import './tokens.js?v=bd5d7425';
import './tx.js?v=bd5d7425';
import './storage.js?v=bd5d7425';
import './boot.js?v=bd5d7425';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=bd5d7425';
// a sideways swipe moves between the five tabs
import './swipe.js?v=bd5d7425';
// Core assets: market, stake and peg next to the balances
import './core.js?v=bd5d7425';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=bd5d7425';
