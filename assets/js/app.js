// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=cd4cbd5f';
import './onboarding.js?v=cd4cbd5f';
import './crypto.js?v=cd4cbd5f';
import './chain.js?v=cd4cbd5f';
import './market.js?v=cd4cbd5f';
import './tokens.js?v=cd4cbd5f';
import './tx.js?v=cd4cbd5f';
import './storage.js?v=cd4cbd5f';
import './boot.js?v=cd4cbd5f';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=cd4cbd5f';
// a sideways swipe moves between the five tabs
import './swipe.js?v=cd4cbd5f';
// Core assets: market, stake and peg next to the balances
import './core.js?v=cd4cbd5f';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=cd4cbd5f';
