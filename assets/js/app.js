// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=735adfac';
import './onboarding.js?v=735adfac';
import './crypto.js?v=735adfac';
import './chain.js?v=735adfac';
import './market.js?v=735adfac';
import './tokens.js?v=735adfac';
import './tx.js?v=735adfac';
import './storage.js?v=735adfac';
import './boot.js?v=735adfac';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=735adfac';
// a sideways swipe moves between the five tabs
import './swipe.js?v=735adfac';
// Core assets: market, stake and peg next to the balances
import './core.js?v=735adfac';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=735adfac';
