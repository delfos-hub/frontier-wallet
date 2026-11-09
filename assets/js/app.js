// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=fcc11ed6';
import './onboarding.js?v=fcc11ed6';
import './crypto.js?v=fcc11ed6';
import './chain.js?v=fcc11ed6';
import './market.js?v=fcc11ed6';
import './tokens.js?v=fcc11ed6';
import './tx.js?v=fcc11ed6';
import './storage.js?v=fcc11ed6';
import './boot.js?v=fcc11ed6';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=fcc11ed6';
// a sideways swipe moves between the five tabs
import './swipe.js?v=fcc11ed6';
// Core assets: market, stake and peg next to the balances
import './core.js?v=fcc11ed6';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=fcc11ed6';
