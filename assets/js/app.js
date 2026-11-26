// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=fc51a743';
import './onboarding.js?v=fc51a743';
import './crypto.js?v=fc51a743';
import './chain.js?v=fc51a743';
import './market.js?v=fc51a743';
import './tokens.js?v=fc51a743';
import './tx.js?v=fc51a743';
import './storage.js?v=fc51a743';
import './boot.js?v=fc51a743';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=fc51a743';
// a sideways swipe moves between the five tabs
import './swipe.js?v=fc51a743';
// Core assets: market, stake and peg next to the balances
import './core.js?v=fc51a743';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=fc51a743';
