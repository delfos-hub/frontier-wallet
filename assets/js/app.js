// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=d28c5b44';
import './onboarding.js?v=d28c5b44';
import './crypto.js?v=d28c5b44';
import './chain.js?v=d28c5b44';
import './market.js?v=d28c5b44';
import './tokens.js?v=d28c5b44';
import './tx.js?v=d28c5b44';
import './storage.js?v=d28c5b44';
import './boot.js?v=d28c5b44';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=d28c5b44';
// a sideways swipe moves between the five tabs
import './swipe.js?v=d28c5b44';
// Core assets: market, stake and peg next to the balances
import './core.js?v=d28c5b44';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=d28c5b44';
