// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=c32c17ef';
import './onboarding.js?v=c32c17ef';
import './crypto.js?v=c32c17ef';
import './chain.js?v=c32c17ef';
import './market.js?v=c32c17ef';
import './tokens.js?v=c32c17ef';
import './tx.js?v=c32c17ef';
import './storage.js?v=c32c17ef';
import './boot.js?v=c32c17ef';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=c32c17ef';
// a sideways swipe moves between the five tabs
import './swipe.js?v=c32c17ef';
// Core assets: market, stake and peg next to the balances
import './core.js?v=c32c17ef';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=c32c17ef';
