// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=a030bc00';
import './onboarding.js?v=a030bc00';
import './crypto.js?v=a030bc00';
import './chain.js?v=a030bc00';
import './market.js?v=a030bc00';
import './tokens.js?v=a030bc00';
import './tx.js?v=a030bc00';
import './storage.js?v=a030bc00';
import './boot.js?v=a030bc00';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=a030bc00';
// a sideways swipe moves between the five tabs
import './swipe.js?v=a030bc00';
// Core assets: market, stake and peg next to the balances
import './core.js?v=a030bc00';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=a030bc00';
