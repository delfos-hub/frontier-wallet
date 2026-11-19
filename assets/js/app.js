// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=e41db276';
import './onboarding.js?v=e41db276';
import './crypto.js?v=e41db276';
import './chain.js?v=e41db276';
import './market.js?v=e41db276';
import './tokens.js?v=e41db276';
import './tx.js?v=e41db276';
import './storage.js?v=e41db276';
import './boot.js?v=e41db276';
// the 3D room behind the screens, following the phone in the hand
import './scene.js?v=e41db276';
// a sideways swipe moves between the five tabs
import './swipe.js?v=e41db276';
// Core assets: market, stake and peg next to the balances
import './core.js?v=e41db276';
// interface language, last: it translates what the others have drawn
import './i18n.js?v=e41db276';
