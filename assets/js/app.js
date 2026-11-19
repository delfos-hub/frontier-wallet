// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=f1aa74f9';
import './onboarding.js?v=f1aa74f9';
import './crypto.js?v=f1aa74f9';
import './chain.js?v=f1aa74f9';
import './market.js?v=f1aa74f9';
import './tokens.js?v=f1aa74f9';
import './tx.js?v=f1aa74f9';
import './storage.js?v=f1aa74f9';
import './boot.js?v=f1aa74f9';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=f1aa74f9';
// a sideways swipe moves between the five tabs
import './swipe.js?v=f1aa74f9';
// Core assets: market, stake and peg next to the balances
import './core.js?v=f1aa74f9';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=f1aa74f9';
