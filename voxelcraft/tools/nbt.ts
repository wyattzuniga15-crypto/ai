/** Minimal NBT reader for Minecraft's structure templates (gzip or raw, big-endian). */
import zlib from 'node:zlib';

export type NbtValue = number | bigint | string | number[] | bigint[] | NbtValue[] | NbtTag | null;
export interface NbtTag { [key: string]: NbtValue }

class Reader {
  private off = 0;
  constructor(private readonly buf: Buffer) {}
  byte(): number { return this.buf.readInt8(this.off++); }
  ubyte(): number { return this.buf.readUInt8(this.off++); }
  short(): number { const v = this.buf.readInt16BE(this.off); this.off += 2; return v; }
  int(): number { const v = this.buf.readInt32BE(this.off); this.off += 4; return v; }
  long(): bigint { const v = this.buf.readBigInt64BE(this.off); this.off += 8; return v; }
  float(): number { const v = this.buf.readFloatBE(this.off); this.off += 4; return v; }
  double(): number { const v = this.buf.readDoubleBE(this.off); this.off += 8; return v; }
  string(): string { const len = this.buf.readUInt16BE(this.off); this.off += 2; const s = this.buf.toString('utf8', this.off, this.off + len); this.off += len; return s; }
  bytes(n: number): number[] { const out: number[] = []; for (let i = 0; i < n; i++) out.push(this.byte()); return out; }

  value(type: number): NbtValue {
    switch (type) {
      case 1: return this.byte();
      case 2: return this.short();
      case 3: return this.int();
      case 4: return this.long();
      case 5: return this.float();
      case 6: return this.double();
      case 7: return this.bytes(this.int());
      case 8: return this.string();
      case 9: {
        const itemType = this.ubyte();
        const len = this.int();
        const out: NbtValue[] = [];
        for (let i = 0; i < len; i++) out.push(this.value(itemType));
        return out;
      }
      case 10: return this.compound();
      case 11: { const len = this.int(); const out: number[] = []; for (let i = 0; i < len; i++) out.push(this.int()); return out; }
      case 12: { const len = this.int(); const out: bigint[] = []; for (let i = 0; i < len; i++) out.push(this.long()); return out; }
      default: throw new Error(`unknown NBT tag ${type}`);
    }
  }

  compound(): NbtTag {
    const out: NbtTag = {};
    for (;;) {
      const type = this.ubyte();
      if (type === 0) return out;
      const name = this.string();
      out[name] = this.value(type);
    }
  }
}

/** Reads a (possibly gzipped) NBT file and returns its root compound. */
export function readNbt(data: Buffer): NbtTag {
  const buf = data[0] === 0x1f && data[1] === 0x8b ? zlib.gunzipSync(data) : data;
  const r = new Reader(buf);
  const type = r.ubyte();
  if (type !== 10) throw new Error('NBT root is not a compound');
  r.string(); // root name, always empty in structure files
  return r.compound();
}
