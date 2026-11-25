// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=7a0969e1';
import './onboarding.js?v=7a0969e1';
import './crypto.js?v=7a0969e1';
import './chain.js?v=7a0969e1';
import './market.js?v=7a0969e1';
import './tokens.js?v=7a0969e1';
import './tx.js?v=7a0969e1';
import './storage.js?v=7a0969e1';
import './boot.js?v=7a0969e1';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=7a0969e1';
// a sideways swipe moves between the five tabs
import './swipe.js?v=7a0969e1';
// Core assets: market, stake and peg next to the balances
import './core.js?v=7a0969e1';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=7a0969e1';
