// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=b8904430';
import './onboarding.js?v=b8904430';
import './crypto.js?v=b8904430';
import './chain.js?v=b8904430';
import './market.js?v=b8904430';
import './tokens.js?v=b8904430';
import './tx.js?v=b8904430';
import './storage.js?v=b8904430';
import './boot.js?v=b8904430';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=b8904430';
// a sideways swipe moves between the five tabs
import './swipe.js?v=b8904430';
// Core assets: market, stake and peg next to the balances
import './core.js?v=b8904430';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=b8904430';
