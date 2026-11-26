// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=50e2040f';
import './onboarding.js?v=50e2040f';
import './crypto.js?v=50e2040f';
import './chain.js?v=50e2040f';
import './market.js?v=50e2040f';
import './tokens.js?v=50e2040f';
import './tx.js?v=50e2040f';
import './storage.js?v=50e2040f';
import './boot.js?v=50e2040f';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=50e2040f';
// a sideways swipe moves between the five tabs
import './swipe.js?v=50e2040f';
// Core assets: market, stake and peg next to the balances
import './core.js?v=50e2040f';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=50e2040f';
