// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=61434eb6';
import './onboarding.js?v=61434eb6';
import './crypto.js?v=61434eb6';
import './chain.js?v=61434eb6';
import './market.js?v=61434eb6';
import './tokens.js?v=61434eb6';
import './tx.js?v=61434eb6';
import './storage.js?v=61434eb6';
import './boot.js?v=61434eb6';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=61434eb6';
// a sideways swipe moves between the five tabs
import './swipe.js?v=61434eb6';
// Core assets: market, stake and peg next to the balances
import './core.js?v=61434eb6';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=61434eb6';
