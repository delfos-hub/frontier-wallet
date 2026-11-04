// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=1381fb60';
import './onboarding.js?v=1381fb60';
import './crypto.js?v=1381fb60';
import './chain.js?v=1381fb60';
import './market.js?v=1381fb60';
import './tokens.js?v=1381fb60';
import './tx.js?v=1381fb60';
import './storage.js?v=1381fb60';
import './boot.js?v=1381fb60';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=1381fb60';
// a sideways swipe moves between the five tabs
import './swipe.js?v=1381fb60';
// Core assets: market, stake and peg next to the balances
import './core.js?v=1381fb60';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=1381fb60';
