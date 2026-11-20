// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=decadaba';
import './onboarding.js?v=decadaba';
import './crypto.js?v=decadaba';
import './chain.js?v=decadaba';
import './market.js?v=decadaba';
import './tokens.js?v=decadaba';
import './tx.js?v=decadaba';
import './storage.js?v=decadaba';
import './boot.js?v=decadaba';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=decadaba';
// a sideways swipe moves between the five tabs
import './swipe.js?v=decadaba';
// Core assets: market, stake and peg next to the balances
import './core.js?v=decadaba';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=decadaba';
