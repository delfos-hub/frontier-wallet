// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=bcd7a552';
import './onboarding.js?v=bcd7a552';
import './crypto.js?v=bcd7a552';
import './chain.js?v=bcd7a552';
import './market.js?v=bcd7a552';
import './tokens.js?v=bcd7a552';
import './tx.js?v=bcd7a552';
import './storage.js?v=bcd7a552';
import './boot.js?v=bcd7a552';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=bcd7a552';
// a sideways swipe moves between the five tabs
import './swipe.js?v=bcd7a552';
// Core assets: market, stake and peg next to the balances
import './core.js?v=bcd7a552';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=bcd7a552';
