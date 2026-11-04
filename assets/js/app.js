// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=bf17f1f2';
import './onboarding.js?v=bf17f1f2';
import './crypto.js?v=bf17f1f2';
import './chain.js?v=bf17f1f2';
import './market.js?v=bf17f1f2';
import './tokens.js?v=bf17f1f2';
import './tx.js?v=bf17f1f2';
import './storage.js?v=bf17f1f2';
import './boot.js?v=bf17f1f2';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=bf17f1f2';
// a sideways swipe moves between the five tabs
import './swipe.js?v=bf17f1f2';
// Core assets: market, stake and peg next to the balances
import './core.js?v=bf17f1f2';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=bf17f1f2';
