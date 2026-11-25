// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=d808ed93';
import './onboarding.js?v=d808ed93';
import './crypto.js?v=d808ed93';
import './chain.js?v=d808ed93';
import './market.js?v=d808ed93';
import './tokens.js?v=d808ed93';
import './tx.js?v=d808ed93';
import './storage.js?v=d808ed93';
import './boot.js?v=d808ed93';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=d808ed93';
// a sideways swipe moves between the five tabs
import './swipe.js?v=d808ed93';
// Core assets: market, stake and peg next to the balances
import './core.js?v=d808ed93';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=d808ed93';
