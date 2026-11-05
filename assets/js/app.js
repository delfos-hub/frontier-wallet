// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=4cc1e2a0';
import './onboarding.js?v=4cc1e2a0';
import './crypto.js?v=4cc1e2a0';
import './chain.js?v=4cc1e2a0';
import './market.js?v=4cc1e2a0';
import './tokens.js?v=4cc1e2a0';
import './tx.js?v=4cc1e2a0';
import './storage.js?v=4cc1e2a0';
import './boot.js?v=4cc1e2a0';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=4cc1e2a0';
// a sideways swipe moves between the five tabs
import './swipe.js?v=4cc1e2a0';
// Core assets: market, stake and peg next to the balances
import './core.js?v=4cc1e2a0';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=4cc1e2a0';
