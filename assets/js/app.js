// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=4ef6d73a';
import './onboarding.js?v=4ef6d73a';
import './crypto.js?v=4ef6d73a';
import './chain.js?v=4ef6d73a';
import './market.js?v=4ef6d73a';
import './tokens.js?v=4ef6d73a';
import './tx.js?v=4ef6d73a';
import './storage.js?v=4ef6d73a';
import './boot.js?v=4ef6d73a';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=4ef6d73a';
// a sideways swipe moves between the five tabs
import './swipe.js?v=4ef6d73a';
// Core assets: market, stake and peg next to the balances
import './core.js?v=4ef6d73a';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=4ef6d73a';
