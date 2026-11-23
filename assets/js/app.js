// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=5bd0e71a';
import './onboarding.js?v=5bd0e71a';
import './crypto.js?v=5bd0e71a';
import './chain.js?v=5bd0e71a';
import './market.js?v=5bd0e71a';
import './tokens.js?v=5bd0e71a';
import './tx.js?v=5bd0e71a';
import './storage.js?v=5bd0e71a';
import './boot.js?v=5bd0e71a';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=5bd0e71a';
// a sideways swipe moves between the five tabs
import './swipe.js?v=5bd0e71a';
// Core assets: market, stake and peg next to the balances
import './core.js?v=5bd0e71a';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=5bd0e71a';
