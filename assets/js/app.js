// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=a7932775';
import './onboarding.js?v=a7932775';
import './crypto.js?v=a7932775';
import './chain.js?v=a7932775';
import './market.js?v=a7932775';
import './tokens.js?v=a7932775';
import './tx.js?v=a7932775';
import './storage.js?v=a7932775';
import './boot.js?v=a7932775';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=a7932775';
// a sideways swipe moves between the five tabs
import './swipe.js?v=a7932775';
// Core assets: market, stake and peg next to the balances
import './core.js?v=a7932775';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=a7932775';
