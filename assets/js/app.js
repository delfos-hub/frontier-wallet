// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=1346d19d';
import './onboarding.js?v=1346d19d';
import './crypto.js?v=1346d19d';
import './chain.js?v=1346d19d';
import './market.js?v=1346d19d';
import './tokens.js?v=1346d19d';
import './tx.js?v=1346d19d';
import './storage.js?v=1346d19d';
import './boot.js?v=1346d19d';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=1346d19d';
// a sideways swipe moves between the five tabs
import './swipe.js?v=1346d19d';
// Core assets: market, stake and peg next to the balances
import './core.js?v=1346d19d';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=1346d19d';
