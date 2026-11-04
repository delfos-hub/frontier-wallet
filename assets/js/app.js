// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=2688e3fd';
import './onboarding.js?v=2688e3fd';
import './crypto.js?v=2688e3fd';
import './chain.js?v=2688e3fd';
import './market.js?v=2688e3fd';
import './tokens.js?v=2688e3fd';
import './tx.js?v=2688e3fd';
import './storage.js?v=2688e3fd';
import './boot.js?v=2688e3fd';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=2688e3fd';
// a sideways swipe moves between the five tabs
import './swipe.js?v=2688e3fd';
// Core assets: market, stake and peg next to the balances
import './core.js?v=2688e3fd';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=2688e3fd';
