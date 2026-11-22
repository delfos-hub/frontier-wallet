// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=ccb4ccd6';
import './onboarding.js?v=ccb4ccd6';
import './crypto.js?v=ccb4ccd6';
import './chain.js?v=ccb4ccd6';
import './market.js?v=ccb4ccd6';
import './tokens.js?v=ccb4ccd6';
import './tx.js?v=ccb4ccd6';
import './storage.js?v=ccb4ccd6';
import './boot.js?v=ccb4ccd6';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=ccb4ccd6';
// a sideways swipe moves between the five tabs
import './swipe.js?v=ccb4ccd6';
// Core assets: market, stake and peg next to the balances
import './core.js?v=ccb4ccd6';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=ccb4ccd6';
