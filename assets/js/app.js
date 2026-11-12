// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=68e386e5';
import './onboarding.js?v=68e386e5';
import './crypto.js?v=68e386e5';
import './chain.js?v=68e386e5';
import './market.js?v=68e386e5';
import './tokens.js?v=68e386e5';
import './tx.js?v=68e386e5';
import './storage.js?v=68e386e5';
import './boot.js?v=68e386e5';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=68e386e5';
// a sideways swipe moves between the five tabs
import './swipe.js?v=68e386e5';
// Core assets: market, stake and peg next to the balances
import './core.js?v=68e386e5';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=68e386e5';
