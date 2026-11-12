// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=1072f2a7';
import './onboarding.js?v=1072f2a7';
import './crypto.js?v=1072f2a7';
import './chain.js?v=1072f2a7';
import './market.js?v=1072f2a7';
import './tokens.js?v=1072f2a7';
import './tx.js?v=1072f2a7';
import './storage.js?v=1072f2a7';
import './boot.js?v=1072f2a7';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=1072f2a7';
// a sideways swipe moves between the five tabs
import './swipe.js?v=1072f2a7';
// Core assets: market, stake and peg next to the balances
import './core.js?v=1072f2a7';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=1072f2a7';
