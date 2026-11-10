// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=e9139182';
import './onboarding.js?v=e9139182';
import './crypto.js?v=e9139182';
import './chain.js?v=e9139182';
import './market.js?v=e9139182';
import './tokens.js?v=e9139182';
import './tx.js?v=e9139182';
import './storage.js?v=e9139182';
import './boot.js?v=e9139182';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=e9139182';
// a sideways swipe moves between the five tabs
import './swipe.js?v=e9139182';
// Core assets: market, stake and peg next to the balances
import './core.js?v=e9139182';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=e9139182';
