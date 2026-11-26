// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=f77939fa';
import './onboarding.js?v=f77939fa';
import './crypto.js?v=f77939fa';
import './chain.js?v=f77939fa';
import './market.js?v=f77939fa';
import './tokens.js?v=f77939fa';
import './tx.js?v=f77939fa';
import './storage.js?v=f77939fa';
import './boot.js?v=f77939fa';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=f77939fa';
// a sideways swipe moves between the five tabs
import './swipe.js?v=f77939fa';
// Core assets: market, stake and peg next to the balances
import './core.js?v=f77939fa';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=f77939fa';
