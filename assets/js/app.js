// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=bc42d540';
import './onboarding.js?v=bc42d540';
import './crypto.js?v=bc42d540';
import './chain.js?v=bc42d540';
import './market.js?v=bc42d540';
import './tokens.js?v=bc42d540';
import './tx.js?v=bc42d540';
import './storage.js?v=bc42d540';
import './boot.js?v=bc42d540';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=bc42d540';
// a sideways swipe moves between the five tabs
import './swipe.js?v=bc42d540';
// Core assets: market, stake and peg next to the balances
import './core.js?v=bc42d540';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=bc42d540';
