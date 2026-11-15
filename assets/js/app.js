// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=c465368d';
import './onboarding.js?v=c465368d';
import './crypto.js?v=c465368d';
import './chain.js?v=c465368d';
import './market.js?v=c465368d';
import './tokens.js?v=c465368d';
import './tx.js?v=c465368d';
import './storage.js?v=c465368d';
import './boot.js?v=c465368d';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=c465368d';
// a sideways swipe moves between the five tabs
import './swipe.js?v=c465368d';
// Core assets: market, stake and peg next to the balances
import './core.js?v=c465368d';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=c465368d';
