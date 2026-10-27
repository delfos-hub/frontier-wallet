/* The external messages the GRAM swap sends to a TON lock.

   Claim and refund are external messages: free for whoever sends them, and
   the lock pays only where its terms say. The seller's wallet sends the claim
   itself when the relayer has not (audit round 3, A), so these bytes are what
   releases the seller's GRAM. The expected BOCs below were made with @ton/core
   (storeMessage(external({ to, body }))) from the same lock address and
   secret; the claim was also accepted by the real lock code in a sandbox,
   paying its recipient (widgets, contracts/htlc-swap-ton). */
import path from 'path';
import { pathToFileURL } from 'url';
import { ok, group, report } from './harness.mjs';

const SRC = path.resolve(process.argv[2] || 'assets/js');
const { claimMessage, refundMessage } = await import(pathToFileURL(path.join(SRC, 'gram-tonlock.js')).href);

const LOCK = '0:' + 'ab'.repeat(32);
const SECRET = '11'.repeat(16) + '22'.repeat(16);
const CORE = {
  claim: 'te6cckEBAQEASQAAjYgBV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1YDG2MLSIiIiIiIiIiIiIiIiIiIiIkREREREREREREREREREREUsn3XRg==',
  refund: 'te6cckEBAQEAKQAATYgBV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1YDkyszrKhfQhc=',
};

group('external messages to a TON lock');
ok('claim: the same BOC as @ton/core', claimMessage(LOCK, SECRET) === CORE.claim, claimMessage(LOCK, SECRET));
ok('claim: an upper-case secret gives the same message', claimMessage(LOCK, SECRET.toUpperCase()) === CORE.claim);
ok('refund: the same BOC as @ton/core', refundMessage(LOCK) === CORE.refund, refundMessage(LOCK));
let threw = false;
try { claimMessage(LOCK, 'not-a-secret'); } catch (e) { threw = true; }
ok('claim: a secret that is not 32 bytes of hex is refused', threw);
threw = false;
try { claimMessage(LOCK, SECRET.slice(2)); } catch (e) { threw = true; }
ok('claim: a 31-byte secret is refused', threw);

report();
