// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=d034d3c6';
import './onboarding.js?v=d034d3c6';
import './crypto.js?v=d034d3c6';
import './chain.js?v=d034d3c6';
import './market.js?v=d034d3c6';
import './tokens.js?v=d034d3c6';
import './tx.js?v=d034d3c6';
import './storage.js?v=d034d3c6';
import './boot.js?v=d034d3c6';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=d034d3c6';
// a sideways swipe moves between the five tabs
import './swipe.js?v=d034d3c6';
// Core assets: market, stake and peg next to the balances
import './core.js?v=d034d3c6';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=d034d3c6';
