// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=ef1415da';
import './onboarding.js?v=ef1415da';
import './crypto.js?v=ef1415da';
import './chain.js?v=ef1415da';
import './market.js?v=ef1415da';
import './tokens.js?v=ef1415da';
import './tx.js?v=ef1415da';
import './storage.js?v=ef1415da';
import './boot.js?v=ef1415da';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=ef1415da';
// a sideways swipe moves between the five tabs
import './swipe.js?v=ef1415da';
// Core assets: market, stake and peg next to the balances
import './core.js?v=ef1415da';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=ef1415da';
