// Firefox's (and Zen's) .jsonlz4 files: the magic "mozLz40\0", the decompressed size as a
// little-endian uint32, then one raw LZ4 block.
const MAGIC = "mozLz40\0";

export function decodeMozLz4(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) throw new Error("not a mozLz4 file");
  const size = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
  return new TextDecoder().decode(decodeLz4Block(bytes.subarray(12), size >>> 0));
}

// The LZ4 block format: sequences of literals then a back-reference into the output so far.
export function decodeLz4Block(src, size) {
  const out = new Uint8Array(size);
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const token = src[i++];
    let literals = token >> 4;
    if (literals === 15) {
      let b;
      do {
        b = src[i++];
        literals += b;
      } while (b === 255);
    }
    if (o + literals > size || i + literals > src.length) throw new Error("corrupt LZ4 block");
    out.set(src.subarray(i, i + literals), o);
    i += literals;
    o += literals;
    if (i >= src.length) break; // the last sequence has literals only
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    if (!offset || offset > o) throw new Error("corrupt LZ4 block");
    let length = (token & 15) + 4;
    if ((token & 15) === 15) {
      let b;
      do {
        b = src[i++];
        length += b;
      } while (b === 255);
    }
    if (o + length > size) throw new Error("corrupt LZ4 block");
    for (let k = 0; k < length; k++, o++) out[o] = out[o - offset];
  }
  return out.subarray(0, o);
}
