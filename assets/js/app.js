// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=dfea3f9d';
import './onboarding.js?v=dfea3f9d';
import './crypto.js?v=dfea3f9d';
import './chain.js?v=dfea3f9d';
import './market.js?v=dfea3f9d';
import './tokens.js?v=dfea3f9d';
import './tx.js?v=dfea3f9d';
import './storage.js?v=dfea3f9d';
import './boot.js?v=dfea3f9d';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=dfea3f9d';
// a sideways swipe moves between the five tabs
import './swipe.js?v=dfea3f9d';
// Core assets: market, stake and peg next to the balances
import './core.js?v=dfea3f9d';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=dfea3f9d';
