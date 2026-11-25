// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=bbd88b0a';
import './onboarding.js?v=bbd88b0a';
import './crypto.js?v=bbd88b0a';
import './chain.js?v=bbd88b0a';
import './market.js?v=bbd88b0a';
import './tokens.js?v=bbd88b0a';
import './tx.js?v=bbd88b0a';
import './storage.js?v=bbd88b0a';
import './boot.js?v=bbd88b0a';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=bbd88b0a';
// a sideways swipe moves between the five tabs
import './swipe.js?v=bbd88b0a';
// Core assets: market, stake and peg next to the balances
import './core.js?v=bbd88b0a';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=bbd88b0a';
