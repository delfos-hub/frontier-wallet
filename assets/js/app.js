// Loading order matches the order these blocks had in index.html.
// Several of them attach handlers as they run, so the sequence is not
// cosmetic.
import './shell.js?v=42cc1f90';
import './onboarding.js?v=42cc1f90';
import './crypto.js?v=42cc1f90';
import './chain.js?v=42cc1f90';
import './market.js?v=42cc1f90';
import './tokens.js?v=42cc1f90';
import './tx.js?v=42cc1f90';
import './storage.js?v=42cc1f90';
import './boot.js?v=42cc1f90';
