// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=caced94f';
import './onboarding.js?v=caced94f';
import './crypto.js?v=caced94f';
import './chain.js?v=caced94f';
import './market.js?v=caced94f';
import './tokens.js?v=caced94f';
import './tx.js?v=caced94f';
import './storage.js?v=caced94f';
import './boot.js?v=caced94f';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=caced94f';
// a sideways swipe moves between the five tabs
import './swipe.js?v=caced94f';
// Core assets: market, stake and peg next to the balances
import './core.js?v=caced94f';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=caced94f';
