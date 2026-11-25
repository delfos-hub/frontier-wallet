// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=cd822c7c';
import './onboarding.js?v=cd822c7c';
import './crypto.js?v=cd822c7c';
import './chain.js?v=cd822c7c';
import './market.js?v=cd822c7c';
import './tokens.js?v=cd822c7c';
import './tx.js?v=cd822c7c';
import './storage.js?v=cd822c7c';
import './boot.js?v=cd822c7c';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=cd822c7c';
// a sideways swipe moves between the five tabs
import './swipe.js?v=cd822c7c';
// Core assets: market, stake and peg next to the balances
import './core.js?v=cd822c7c';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=cd822c7c';
