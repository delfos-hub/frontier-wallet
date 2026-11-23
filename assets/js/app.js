// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=ef16c24d';
import './onboarding.js?v=ef16c24d';
import './crypto.js?v=ef16c24d';
import './chain.js?v=ef16c24d';
import './market.js?v=ef16c24d';
import './tokens.js?v=ef16c24d';
import './tx.js?v=ef16c24d';
import './storage.js?v=ef16c24d';
import './boot.js?v=ef16c24d';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=ef16c24d';
// a sideways swipe moves between the five tabs
import './swipe.js?v=ef16c24d';
// Core assets: market, stake and peg next to the balances
import './core.js?v=ef16c24d';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=ef16c24d';
