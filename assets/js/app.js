// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=25fbb4fc';
import './onboarding.js?v=25fbb4fc';
import './crypto.js?v=25fbb4fc';
import './chain.js?v=25fbb4fc';
import './market.js?v=25fbb4fc';
import './tokens.js?v=25fbb4fc';
import './tx.js?v=25fbb4fc';
import './storage.js?v=25fbb4fc';
import './boot.js?v=25fbb4fc';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=25fbb4fc';
// a sideways swipe moves between the five tabs
import './swipe.js?v=25fbb4fc';
// Core assets: market, stake and peg next to the balances
import './core.js?v=25fbb4fc';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=25fbb4fc';
