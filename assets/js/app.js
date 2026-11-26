// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js';
import './onboarding.js';
import './crypto.js';
import './chain.js';
import './market.js';
import './tokens.js';
import './tx.js';
import './storage.js';
import './boot.js';
// the 3D room behind the screens, following the phone in the hand
import './scene.js';
// a sideways swipe moves between the five tabs
import './swipe.js';
// Core assets: market, stake and peg next to the balances
import './core.js';
// interface language, last: it translates what the others have drawn
import './i18n.js';
