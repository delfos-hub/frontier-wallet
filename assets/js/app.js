// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=f39e2de6';
import './onboarding.js?v=f39e2de6';
import './crypto.js?v=f39e2de6';
import './chain.js?v=f39e2de6';
import './market.js?v=f39e2de6';
import './tokens.js?v=f39e2de6';
import './tx.js?v=f39e2de6';
import './storage.js?v=f39e2de6';
import './boot.js?v=f39e2de6';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=f39e2de6';
// a sideways swipe moves between the five tabs
import './swipe.js?v=f39e2de6';
// Core assets: market, stake and peg next to the balances
import './core.js?v=f39e2de6';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=f39e2de6';
