// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=d3a72c42';
import './onboarding.js?v=d3a72c42';
import './crypto.js?v=d3a72c42';
import './chain.js?v=d3a72c42';
import './market.js?v=d3a72c42';
import './tokens.js?v=d3a72c42';
import './tx.js?v=d3a72c42';
import './storage.js?v=d3a72c42';
import './boot.js?v=d3a72c42';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=d3a72c42';
// a sideways swipe moves between the five tabs
import './swipe.js?v=d3a72c42';
// Core assets: market, stake and peg next to the balances
import './core.js?v=d3a72c42';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=d3a72c42';
