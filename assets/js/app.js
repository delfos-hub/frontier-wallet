// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=dfbc2dde';
import './onboarding.js?v=dfbc2dde';
import './crypto.js?v=dfbc2dde';
import './chain.js?v=dfbc2dde';
import './market.js?v=dfbc2dde';
import './tokens.js?v=dfbc2dde';
import './tx.js?v=dfbc2dde';
import './storage.js?v=dfbc2dde';
import './boot.js?v=dfbc2dde';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=dfbc2dde';
// a sideways swipe moves between the five tabs
import './swipe.js?v=dfbc2dde';
// Core assets: market, stake and peg next to the balances
import './core.js?v=dfbc2dde';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=dfbc2dde';
