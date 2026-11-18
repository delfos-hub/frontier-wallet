// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=51559b5f';
import './onboarding.js?v=51559b5f';
import './crypto.js?v=51559b5f';
import './chain.js?v=51559b5f';
import './market.js?v=51559b5f';
import './tokens.js?v=51559b5f';
import './tx.js?v=51559b5f';
import './storage.js?v=51559b5f';
import './boot.js?v=51559b5f';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=51559b5f';
// a sideways swipe moves between the five tabs
import './swipe.js?v=51559b5f';
// Core assets: market, stake and peg next to the balances
import './core.js?v=51559b5f';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=51559b5f';
