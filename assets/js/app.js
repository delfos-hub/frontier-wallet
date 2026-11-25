// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=ea84df22';
import './onboarding.js?v=ea84df22';
import './crypto.js?v=ea84df22';
import './chain.js?v=ea84df22';
import './market.js?v=ea84df22';
import './tokens.js?v=ea84df22';
import './tx.js?v=ea84df22';
import './storage.js?v=ea84df22';
import './boot.js?v=ea84df22';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=ea84df22';
// a sideways swipe moves between the five tabs
import './swipe.js?v=ea84df22';
// Core assets: market, stake and peg next to the balances
import './core.js?v=ea84df22';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=ea84df22';
