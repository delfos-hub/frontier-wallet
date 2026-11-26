// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=13e9286f';
import './onboarding.js?v=13e9286f';
import './crypto.js?v=13e9286f';
import './chain.js?v=13e9286f';
import './market.js?v=13e9286f';
import './tokens.js?v=13e9286f';
import './tx.js?v=13e9286f';
import './storage.js?v=13e9286f';
import './boot.js?v=13e9286f';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=13e9286f';
// a sideways swipe moves between the five tabs
import './swipe.js?v=13e9286f';
// Core assets: market, stake and peg next to the balances
import './core.js?v=13e9286f';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=13e9286f';
