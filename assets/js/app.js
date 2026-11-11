// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=b5bbe3ed';
import './onboarding.js?v=b5bbe3ed';
import './crypto.js?v=b5bbe3ed';
import './chain.js?v=b5bbe3ed';
import './market.js?v=b5bbe3ed';
import './tokens.js?v=b5bbe3ed';
import './tx.js?v=b5bbe3ed';
import './storage.js?v=b5bbe3ed';
import './boot.js?v=b5bbe3ed';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=b5bbe3ed';
// a sideways swipe moves between the five tabs
import './swipe.js?v=b5bbe3ed';
// Core assets: market, stake and peg next to the balances
import './core.js?v=b5bbe3ed';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=b5bbe3ed';
