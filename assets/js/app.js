// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=a131966e';
import './onboarding.js?v=a131966e';
import './crypto.js?v=a131966e';
import './chain.js?v=a131966e';
import './market.js?v=a131966e';
import './tokens.js?v=a131966e';
import './tx.js?v=a131966e';
import './storage.js?v=a131966e';
import './boot.js?v=a131966e';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=a131966e';
// a sideways swipe moves between the five tabs
import './swipe.js?v=a131966e';
// Core assets: market, stake and peg next to the balances
import './core.js?v=a131966e';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=a131966e';
