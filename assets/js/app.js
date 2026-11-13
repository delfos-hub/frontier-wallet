// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=d522290f';
import './onboarding.js?v=d522290f';
import './crypto.js?v=d522290f';
import './chain.js?v=d522290f';
import './market.js?v=d522290f';
import './tokens.js?v=d522290f';
import './tx.js?v=d522290f';
import './storage.js?v=d522290f';
import './boot.js?v=d522290f';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=d522290f';
// a sideways swipe moves between the five tabs
import './swipe.js?v=d522290f';
// Core assets: market, stake and peg next to the balances
import './core.js?v=d522290f';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=d522290f';
