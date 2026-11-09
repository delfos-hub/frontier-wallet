// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=8eca9cc0';
import './onboarding.js?v=8eca9cc0';
import './crypto.js?v=8eca9cc0';
import './chain.js?v=8eca9cc0';
import './market.js?v=8eca9cc0';
import './tokens.js?v=8eca9cc0';
import './tx.js?v=8eca9cc0';
import './storage.js?v=8eca9cc0';
import './boot.js?v=8eca9cc0';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=8eca9cc0';
// a sideways swipe moves between the five tabs
import './swipe.js?v=8eca9cc0';
// Core assets: market, stake and peg next to the balances
import './core.js?v=8eca9cc0';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=8eca9cc0';
