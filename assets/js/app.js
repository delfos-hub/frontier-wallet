// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=c44d372a';
import './onboarding.js?v=c44d372a';
import './crypto.js?v=c44d372a';
import './chain.js?v=c44d372a';
import './market.js?v=c44d372a';
import './tokens.js?v=c44d372a';
import './tx.js?v=c44d372a';
import './storage.js?v=c44d372a';
import './boot.js?v=c44d372a';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=c44d372a';
// a sideways swipe moves between the five tabs
import './swipe.js?v=c44d372a';
// Core assets: market, stake and peg next to the balances
import './core.js?v=c44d372a';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=c44d372a';
