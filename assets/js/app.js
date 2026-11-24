// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=cb59fe64';
import './onboarding.js?v=cb59fe64';
import './crypto.js?v=cb59fe64';
import './chain.js?v=cb59fe64';
import './market.js?v=cb59fe64';
import './tokens.js?v=cb59fe64';
import './tx.js?v=cb59fe64';
import './storage.js?v=cb59fe64';
import './boot.js?v=cb59fe64';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=cb59fe64';
// a sideways swipe moves between the five tabs
import './swipe.js?v=cb59fe64';
// Core assets: market, stake and peg next to the balances
import './core.js?v=cb59fe64';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=cb59fe64';
