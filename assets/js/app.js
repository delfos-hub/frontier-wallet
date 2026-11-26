// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=27cbef9d';
import './onboarding.js?v=27cbef9d';
import './crypto.js?v=27cbef9d';
import './chain.js?v=27cbef9d';
import './market.js?v=27cbef9d';
import './tokens.js?v=27cbef9d';
import './tx.js?v=27cbef9d';
import './storage.js?v=27cbef9d';
import './boot.js?v=27cbef9d';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=27cbef9d';
// a sideways swipe moves between the five tabs
import './swipe.js?v=27cbef9d';
// Core assets: market, stake and peg next to the balances
import './core.js?v=27cbef9d';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=27cbef9d';
