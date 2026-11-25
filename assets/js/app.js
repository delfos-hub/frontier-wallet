// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=25c1ceeb';
import './onboarding.js?v=25c1ceeb';
import './crypto.js?v=25c1ceeb';
import './chain.js?v=25c1ceeb';
import './market.js?v=25c1ceeb';
import './tokens.js?v=25c1ceeb';
import './tx.js?v=25c1ceeb';
import './storage.js?v=25c1ceeb';
import './boot.js?v=25c1ceeb';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=25c1ceeb';
// a sideways swipe moves between the five tabs
import './swipe.js?v=25c1ceeb';
// Core assets: market, stake and peg next to the balances
import './core.js?v=25c1ceeb';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=25c1ceeb';
