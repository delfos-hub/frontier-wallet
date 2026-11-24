// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=ba8afbb2';
import './onboarding.js?v=ba8afbb2';
import './crypto.js?v=ba8afbb2';
import './chain.js?v=ba8afbb2';
import './market.js?v=ba8afbb2';
import './tokens.js?v=ba8afbb2';
import './tx.js?v=ba8afbb2';
import './storage.js?v=ba8afbb2';
import './boot.js?v=ba8afbb2';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=ba8afbb2';
// a sideways swipe moves between the five tabs
import './swipe.js?v=ba8afbb2';
// Core assets: market, stake and peg next to the balances
import './core.js?v=ba8afbb2';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=ba8afbb2';
