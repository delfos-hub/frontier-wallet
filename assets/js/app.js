// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=bb457758';
import './onboarding.js?v=bb457758';
import './crypto.js?v=bb457758';
import './chain.js?v=bb457758';
import './market.js?v=bb457758';
import './tokens.js?v=bb457758';
import './tx.js?v=bb457758';
import './storage.js?v=bb457758';
import './boot.js?v=bb457758';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=bb457758';
// a sideways swipe moves between the five tabs
import './swipe.js?v=bb457758';
// Core assets: market, stake and peg next to the balances
import './core.js?v=bb457758';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=bb457758';
