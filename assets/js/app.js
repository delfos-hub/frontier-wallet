// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=17acb6df';
import './onboarding.js?v=17acb6df';
import './crypto.js?v=17acb6df';
import './chain.js?v=17acb6df';
import './market.js?v=17acb6df';
import './tokens.js?v=17acb6df';
import './tx.js?v=17acb6df';
import './storage.js?v=17acb6df';
import './boot.js?v=17acb6df';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=17acb6df';
// a sideways swipe moves between the five tabs
import './swipe.js?v=17acb6df';
// Core assets: market, stake and peg next to the balances
import './core.js?v=17acb6df';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=17acb6df';
