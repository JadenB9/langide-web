// Shareable links: the program goes in the URL hash, deflated and
// base64url-encoded, so nothing is ever sent to a server.
//   #code=<deflate-raw, base64url>   (normal)
//   #src=<utf-8, base64url>          (browser without CompressionStream)

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
  const buf = await new Response(blob.stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}

export async function encodeShareHash(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  if (typeof CompressionStream === 'undefined') return '#src=' + toBase64Url(bytes);
  const packed = await pipe(bytes, new CompressionStream('deflate-raw'));
  return '#code=' + toBase64Url(packed);
}

// The program in `hash`, or null when it doesn't carry one or it's damaged
export async function decodeShareHash(hash: string): Promise<string | null> {
  const m = /^#(code|src)=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  try {
    let bytes = fromBase64Url(m[2]);
    if (m[1] === 'code') {
      if (typeof DecompressionStream === 'undefined') return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}
