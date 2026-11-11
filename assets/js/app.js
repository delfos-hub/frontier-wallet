// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=6c100e45';
import './onboarding.js?v=6c100e45';
import './crypto.js?v=6c100e45';
import './chain.js?v=6c100e45';
import './market.js?v=6c100e45';
import './tokens.js?v=6c100e45';
import './tx.js?v=6c100e45';
import './storage.js?v=6c100e45';
import './boot.js?v=6c100e45';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=6c100e45';
// a sideways swipe moves between the five tabs
import './swipe.js?v=6c100e45';
// Core assets: market, stake and peg next to the balances
import './core.js?v=6c100e45';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=6c100e45';
