// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=73e97f22';
import './onboarding.js?v=73e97f22';
import './crypto.js?v=73e97f22';
import './chain.js?v=73e97f22';
import './market.js?v=73e97f22';
import './tokens.js?v=73e97f22';
import './tx.js?v=73e97f22';
import './storage.js?v=73e97f22';
import './boot.js?v=73e97f22';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=73e97f22';
// a sideways swipe moves between the five tabs
import './swipe.js?v=73e97f22';
// Core assets: market, stake and peg next to the balances
import './core.js?v=73e97f22';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=73e97f22';
