// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=bade985a';
import './onboarding.js?v=bade985a';
import './crypto.js?v=bade985a';
import './chain.js?v=bade985a';
import './market.js?v=bade985a';
import './tokens.js?v=bade985a';
import './tx.js?v=bade985a';
import './storage.js?v=bade985a';
import './boot.js?v=bade985a';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=bade985a';
// a sideways swipe moves between the five tabs
import './swipe.js?v=bade985a';
// Core assets: market, stake and peg next to the balances
import './core.js?v=bade985a';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=bade985a';
