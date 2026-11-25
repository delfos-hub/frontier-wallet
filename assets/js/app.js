// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=a8311c4d';
import './onboarding.js?v=a8311c4d';
import './crypto.js?v=a8311c4d';
import './chain.js?v=a8311c4d';
import './market.js?v=a8311c4d';
import './tokens.js?v=a8311c4d';
import './tx.js?v=a8311c4d';
import './storage.js?v=a8311c4d';
import './boot.js?v=a8311c4d';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=a8311c4d';
// a sideways swipe moves between the five tabs
import './swipe.js?v=a8311c4d';
// Core assets: market, stake and peg next to the balances
import './core.js?v=a8311c4d';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=a8311c4d';
