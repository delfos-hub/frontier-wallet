// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=f67a981a';
import './onboarding.js?v=f67a981a';
import './crypto.js?v=f67a981a';
import './chain.js?v=f67a981a';
import './market.js?v=f67a981a';
import './tokens.js?v=f67a981a';
import './tx.js?v=f67a981a';
import './storage.js?v=f67a981a';
import './boot.js?v=f67a981a';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=f67a981a';
// a sideways swipe moves between the five tabs
import './swipe.js?v=f67a981a';
// Core assets: market, stake and peg next to the balances
import './core.js?v=f67a981a';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=f67a981a';
