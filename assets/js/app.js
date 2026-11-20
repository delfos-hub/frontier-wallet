// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=dfec9205';
import './onboarding.js?v=dfec9205';
import './crypto.js?v=dfec9205';
import './chain.js?v=dfec9205';
import './market.js?v=dfec9205';
import './tokens.js?v=dfec9205';
import './tx.js?v=dfec9205';
import './storage.js?v=dfec9205';
import './boot.js?v=dfec9205';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=dfec9205';
// a sideways swipe moves between the five tabs
import './swipe.js?v=dfec9205';
// Core assets: market, stake and peg next to the balances
import './core.js?v=dfec9205';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=dfec9205';
