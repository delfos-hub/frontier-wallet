// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=0032696d';
import './onboarding.js?v=0032696d';
import './crypto.js?v=0032696d';
import './chain.js?v=0032696d';
import './market.js?v=0032696d';
import './tokens.js?v=0032696d';
import './tx.js?v=0032696d';
import './storage.js?v=0032696d';
import './boot.js?v=0032696d';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=0032696d';
// a sideways swipe moves between the five tabs
import './swipe.js?v=0032696d';
// Core assets: market, stake and peg next to the balances
import './core.js?v=0032696d';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=0032696d';
