// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=b4e773c0';
import './onboarding.js?v=b4e773c0';
import './crypto.js?v=b4e773c0';
import './chain.js?v=b4e773c0';
import './market.js?v=b4e773c0';
import './tokens.js?v=b4e773c0';
import './tx.js?v=b4e773c0';
import './storage.js?v=b4e773c0';
import './boot.js?v=b4e773c0';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=b4e773c0';
// a sideways swipe moves between the five tabs
import './swipe.js?v=b4e773c0';
// Core assets: market, stake and peg next to the balances
import './core.js?v=b4e773c0';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=b4e773c0';
