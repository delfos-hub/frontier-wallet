// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=75f7d010';
import './onboarding.js?v=75f7d010';
import './crypto.js?v=75f7d010';
import './chain.js?v=75f7d010';
import './market.js?v=75f7d010';
import './tokens.js?v=75f7d010';
import './tx.js?v=75f7d010';
import './storage.js?v=75f7d010';
import './boot.js?v=75f7d010';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=75f7d010';
// a sideways swipe moves between the five tabs
import './swipe.js?v=75f7d010';
// Core assets: market, stake and peg next to the balances
import './core.js?v=75f7d010';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=75f7d010';
