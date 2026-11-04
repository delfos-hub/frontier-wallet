// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=cd6c58db';
import './onboarding.js?v=cd6c58db';
import './crypto.js?v=cd6c58db';
import './chain.js?v=cd6c58db';
import './market.js?v=cd6c58db';
import './tokens.js?v=cd6c58db';
import './tx.js?v=cd6c58db';
import './storage.js?v=cd6c58db';
import './boot.js?v=cd6c58db';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=cd6c58db';
// a sideways swipe moves between the five tabs
import './swipe.js?v=cd6c58db';
// Core assets: market, stake and peg next to the balances
import './core.js?v=cd6c58db';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=cd6c58db';
