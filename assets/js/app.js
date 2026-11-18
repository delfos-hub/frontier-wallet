// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=a4d46b98';
import './onboarding.js?v=a4d46b98';
import './crypto.js?v=a4d46b98';
import './chain.js?v=a4d46b98';
import './market.js?v=a4d46b98';
import './tokens.js?v=a4d46b98';
import './tx.js?v=a4d46b98';
import './storage.js?v=a4d46b98';
import './boot.js?v=a4d46b98';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=a4d46b98';
// a sideways swipe moves between the five tabs
import './swipe.js?v=a4d46b98';
// Core assets: market, stake and peg next to the balances
import './core.js?v=a4d46b98';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=a4d46b98';
