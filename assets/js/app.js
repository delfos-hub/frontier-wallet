// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=326144af';
import './onboarding.js?v=326144af';
import './crypto.js?v=326144af';
import './chain.js?v=326144af';
import './market.js?v=326144af';
import './tokens.js?v=326144af';
import './tx.js?v=326144af';
import './storage.js?v=326144af';
import './boot.js?v=326144af';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=326144af';
// a sideways swipe moves between the five tabs
import './swipe.js?v=326144af';
// Core assets: market, stake and peg next to the balances
import './core.js?v=326144af';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=326144af';
