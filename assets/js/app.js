// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=a9477c0d';
import './onboarding.js?v=a9477c0d';
import './crypto.js?v=a9477c0d';
import './chain.js?v=a9477c0d';
import './market.js?v=a9477c0d';
import './tokens.js?v=a9477c0d';
import './tx.js?v=a9477c0d';
import './storage.js?v=a9477c0d';
import './boot.js?v=a9477c0d';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=a9477c0d';
// a sideways swipe moves between the five tabs
import './swipe.js?v=a9477c0d';
// Core assets: market, stake and peg next to the balances
import './core.js?v=a9477c0d';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=a9477c0d';
