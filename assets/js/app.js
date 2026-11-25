// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=357c9755';
import './onboarding.js?v=357c9755';
import './crypto.js?v=357c9755';
import './chain.js?v=357c9755';
import './market.js?v=357c9755';
import './tokens.js?v=357c9755';
import './tx.js?v=357c9755';
import './storage.js?v=357c9755';
import './boot.js?v=357c9755';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=357c9755';
// a sideways swipe moves between the five tabs
import './swipe.js?v=357c9755';
// Core assets: market, stake and peg next to the balances
import './core.js?v=357c9755';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=357c9755';
