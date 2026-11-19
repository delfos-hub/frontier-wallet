// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=dc67c68f';
import './onboarding.js?v=dc67c68f';
import './crypto.js?v=dc67c68f';
import './chain.js?v=dc67c68f';
import './market.js?v=dc67c68f';
import './tokens.js?v=dc67c68f';
import './tx.js?v=dc67c68f';
import './storage.js?v=dc67c68f';
import './boot.js?v=dc67c68f';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=dc67c68f';
// a sideways swipe moves between the five tabs
import './swipe.js?v=dc67c68f';
// Core assets: market, stake and peg next to the balances
import './core.js?v=dc67c68f';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=dc67c68f';
