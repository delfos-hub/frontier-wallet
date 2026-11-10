// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=50a47d51';
import './onboarding.js?v=50a47d51';
import './crypto.js?v=50a47d51';
import './chain.js?v=50a47d51';
import './market.js?v=50a47d51';
import './tokens.js?v=50a47d51';
import './tx.js?v=50a47d51';
import './storage.js?v=50a47d51';
import './boot.js?v=50a47d51';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=50a47d51';
// a sideways swipe moves between the five tabs
import './swipe.js?v=50a47d51';
// Core assets: market, stake and peg next to the balances
import './core.js?v=50a47d51';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=50a47d51';
