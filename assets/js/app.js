// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=1eb17b2c';
import './onboarding.js?v=1eb17b2c';
import './crypto.js?v=1eb17b2c';
import './chain.js?v=1eb17b2c';
import './market.js?v=1eb17b2c';
import './tokens.js?v=1eb17b2c';
import './tx.js?v=1eb17b2c';
import './storage.js?v=1eb17b2c';
import './boot.js?v=1eb17b2c';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=1eb17b2c';
// a sideways swipe moves between the five tabs
import './swipe.js?v=1eb17b2c';
// Core assets: market, stake and peg next to the balances
import './core.js?v=1eb17b2c';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=1eb17b2c';
