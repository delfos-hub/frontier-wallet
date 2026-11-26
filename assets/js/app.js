// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=40afb5ea';
import './onboarding.js?v=40afb5ea';
import './crypto.js?v=40afb5ea';
import './chain.js?v=40afb5ea';
import './market.js?v=40afb5ea';
import './tokens.js?v=40afb5ea';
import './tx.js?v=40afb5ea';
import './storage.js?v=40afb5ea';
import './boot.js?v=40afb5ea';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=40afb5ea';
// a sideways swipe moves between the five tabs
import './swipe.js?v=40afb5ea';
// Core assets: market, stake and peg next to the balances
import './core.js?v=40afb5ea';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=40afb5ea';
