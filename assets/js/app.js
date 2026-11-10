// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=fe6ad509';
import './onboarding.js?v=fe6ad509';
import './crypto.js?v=fe6ad509';
import './chain.js?v=fe6ad509';
import './market.js?v=fe6ad509';
import './tokens.js?v=fe6ad509';
import './tx.js?v=fe6ad509';
import './storage.js?v=fe6ad509';
import './boot.js?v=fe6ad509';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=fe6ad509';
// a sideways swipe moves between the five tabs
import './swipe.js?v=fe6ad509';
// Core assets: market, stake and peg next to the balances
import './core.js?v=fe6ad509';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=fe6ad509';
