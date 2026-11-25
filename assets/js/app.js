// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=c1d2d90b';
import './onboarding.js?v=c1d2d90b';
import './crypto.js?v=c1d2d90b';
import './chain.js?v=c1d2d90b';
import './market.js?v=c1d2d90b';
import './tokens.js?v=c1d2d90b';
import './tx.js?v=c1d2d90b';
import './storage.js?v=c1d2d90b';
import './boot.js?v=c1d2d90b';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=c1d2d90b';
// a sideways swipe moves between the five tabs
import './swipe.js?v=c1d2d90b';
// Core assets: market, stake and peg next to the balances
import './core.js?v=c1d2d90b';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=c1d2d90b';
