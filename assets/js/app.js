// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=bb2439a8';
import './onboarding.js?v=bb2439a8';
import './crypto.js?v=bb2439a8';
import './chain.js?v=bb2439a8';
import './market.js?v=bb2439a8';
import './tokens.js?v=bb2439a8';
import './tx.js?v=bb2439a8';
import './storage.js?v=bb2439a8';
import './boot.js?v=bb2439a8';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=bb2439a8';
// a sideways swipe moves between the five tabs
import './swipe.js?v=bb2439a8';
// Core assets: market, stake and peg next to the balances
import './core.js?v=bb2439a8';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=bb2439a8';
