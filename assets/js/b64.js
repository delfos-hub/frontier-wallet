/* b64.js - bytes to base64 in bounded chunks (#76 review).

   String.fromCharCode(...bytes) passes every byte as its own argument, and an
   engine's argument limit is far below a contract's size: a 256 KiB Wasm upload
   threw "Maximum call stack size exceeded" before it reached the node. Here
   the bytes go 32 KiB at a time, so any transaction encodes the same way.

   No DOM, no imports: tests/b64.mjs runs it in Node. */

const CHUNK = 0x8000;

export function b64(u8){
  let s = '';
  for (let i = 0; i < u8.length; i += CHUNK) s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  return btoa(s);
}
