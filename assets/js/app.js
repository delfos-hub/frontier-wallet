// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=6edc972c';
import './onboarding.js?v=6edc972c';
import './crypto.js?v=6edc972c';
import './chain.js?v=6edc972c';
import './market.js?v=6edc972c';
import './tokens.js?v=6edc972c';
import './tx.js?v=6edc972c';
import './storage.js?v=6edc972c';
import './boot.js?v=6edc972c';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=6edc972c';
// a sideways swipe moves between the five tabs
import './swipe.js?v=6edc972c';
// Core assets: market, stake and peg next to the balances
import './core.js?v=6edc972c';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=6edc972c';
