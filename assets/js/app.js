// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=a045092f';
import './onboarding.js?v=a045092f';
import './crypto.js?v=a045092f';
import './chain.js?v=a045092f';
import './market.js?v=a045092f';
import './tokens.js?v=a045092f';
import './tx.js?v=a045092f';
import './storage.js?v=a045092f';
import './boot.js?v=a045092f';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=a045092f';
// a sideways swipe moves between the five tabs
import './swipe.js?v=a045092f';
// Core assets: market, stake and peg next to the balances
import './core.js?v=a045092f';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=a045092f';
