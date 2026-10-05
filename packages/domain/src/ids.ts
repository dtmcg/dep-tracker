// Node ids: "n" + 9 base-36 chars of milliseconds + 5 base-36 chars of sequence.
// Time-sortable like a ULID, short enough to read in a CSV, safe in file names.
const SEQ_SPACE = 36 ** 5;
let lastTime = -1;
let seq = 0;

function randomSeq(): number {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  // Leave headroom so increments within one millisecond rarely overflow.
  return (bytes[0] ?? 0) % (SEQ_SPACE / 2);
}

export function newId(now: number = Date.now()): string {
  let time = Math.max(now, lastTime);
  if (time === lastTime) {
    seq += 1;
    if (seq >= SEQ_SPACE) {
      time += 1;
      seq = randomSeq();
    }
  } else {
    seq = randomSeq();
  }
  lastTime = time;
  return "n" + time.toString(36).padStart(9, "0") + seq.toString(36).padStart(5, "0");
}
