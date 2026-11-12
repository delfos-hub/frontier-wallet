// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=c56fd182';
import './onboarding.js?v=c56fd182';
import './crypto.js?v=c56fd182';
import './chain.js?v=c56fd182';
import './market.js?v=c56fd182';
import './tokens.js?v=c56fd182';
import './tx.js?v=c56fd182';
import './storage.js?v=c56fd182';
import './boot.js?v=c56fd182';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=c56fd182';
// a sideways swipe moves between the five tabs
import './swipe.js?v=c56fd182';
// Core assets: market, stake and peg next to the balances
import './core.js?v=c56fd182';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=c56fd182';
