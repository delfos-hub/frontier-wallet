// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=a2345860';
import './onboarding.js?v=a2345860';
import './crypto.js?v=a2345860';
import './chain.js?v=a2345860';
import './market.js?v=a2345860';
import './tokens.js?v=a2345860';
import './tx.js?v=a2345860';
import './storage.js?v=a2345860';
import './boot.js?v=a2345860';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=a2345860';
// a sideways swipe moves between the five tabs
import './swipe.js?v=a2345860';
// Core assets: market, stake and peg next to the balances
import './core.js?v=a2345860';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=a2345860';
