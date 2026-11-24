// Voice notes recorded in the browser: Chrome records Opus audio in a WebM file, while
// WhatsApp voice messages must be Opus in an Ogg file (mono). The audio itself is the same
// Opus data, so this only moves the packets from WebM into Ogg pages (no re-encoding).
//
// WebM: EBML elements; Chrome writes the Segment and Clusters with "unknown size", so the
// walk below never relies on the size of the containers it enters.
// Ogg Opus: RFC 7845 (OpusHead page, OpusTags page, then audio pages with granule positions).

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  Audio: 0xe1,
  BlockGroup: 0xa0,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Channels: 0x9f,
  SimpleBlock: 0xa3,
  Block: 0xa1,
} as const;

/** Containers we step into instead of skipping. */
const ENTER = new Set<number>([ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.Audio, ID.BlockGroup]);

function readId(buf: Buffer, pos: number): { value: number; length: number } | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 4 || pos + length > buf.length) return null;
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + buf[pos + i]!;
  return { value, length };
}

/** Element size; null value = unknown size. */
function readSize(buf: Buffer, pos: number): { value: number | null; length: number } | null {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
  if (length > 8 || pos + length > buf.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i]!;
    if (b !== 0xff) allOnes = false;
    value = value * 256 + b;
  }
  return { value: allOnes ? null : value, length };
}

/** Samples (48 kHz) in one Opus packet, from its TOC byte (RFC 6716 §3.1). */
export function opusPacketSamples(packet: Buffer): number {
  if (packet.length === 0) return 0;
  const toc = packet[0]!;
  const config = toc >> 3;
  let frameTenths: number; // frame duration in tenths of a millisecond
  if (config < 12) frameTenths = [100, 200, 400, 600][config % 4]!;
  else if (config < 16) frameTenths = [100, 200][config % 2]!;
  else frameTenths = [25, 50, 100, 200][config % 4]!;
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return (frames * frameTenths * 48) / 10;
}

// ---- Ogg ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

function oggCrc(data: Buffer): number {
  let crc = 0;
  for (const b of data) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc >>> 0;
}

function oggPage(packets: Buffer[], granule: bigint, serial: number, sequence: number, flags: number): Buffer {
  const segments: number[] = [];
  for (const p of packets) {
    let left = p.length;
    while (left >= 255) {
      segments.push(255);
      left -= 255;
    }
    segments.push(left);
  }
  const header = Buffer.alloc(27 + segments.length);
  header.write("OggS", 0, "ascii");
  header[4] = 0;
  header[5] = flags;
  header.writeBigInt64LE(granule, 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(sequence, 18);
  header.writeUInt32LE(0, 22);
  header[26] = segments.length;
  segments.forEach((s, i) => (header[27 + i] = s));
  const page = Buffer.concat([header, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

function opusTags(): Buffer {
  const vendor = Buffer.from("lead-platform", "utf8");
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
  tags.write("OpusTags", 0, "ascii");
  tags.writeUInt32LE(vendor.length, 8);
  vendor.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + vendor.length);
  return tags;
}

function defaultOpusHead(channels: number): Buffer {
  const head = Buffer.alloc(19);
  head.write("OpusHead", 0, "ascii");
  head[8] = 1;
  head[9] = channels;
  head.writeUInt16LE(312, 10);
  head.writeUInt32LE(48000, 12);
  head.writeInt16LE(0, 16);
  head[18] = 0;
  return head;
}

export interface OggOpus {
  data: Buffer;
  channels: number;
  durationMs: number;
}

/** Opus channel count of an Ogg Opus file (from its OpusHead), or null if it is not one. */
export function oggOpusChannels(ogg: Buffer): number | null {
  if (ogg.subarray(0, 4).toString("ascii") !== "OggS") return null;
  const at = ogg.indexOf("OpusHead", 0, "ascii");
  return at >= 0 && at < 200 ? (ogg[at + 9] ?? null) : null;
}

/** WebM (Opus audio) → Ogg Opus. Null when the file is not WebM with Opus audio. */
export function webmOpusToOgg(webm: Buffer): OggOpus | null {
  let codecId: string | null = null;
  let codecPrivate: Buffer | null = null;
  let channels = 1;
  let opusTrack: number | null = null;
  let trackNumber: number | null = null;
  const packets: Buffer[] = [];

  let pos = 0;
  while (pos < webm.length) {
    const id = readId(webm, pos);
    if (!id) break;
    const size = readSize(webm, pos + id.length);
    if (!size) break;
    const start = pos + id.length + size.length;
    if (ENTER.has(id.value)) {
      if (id.value === ID.TrackEntry) {
        codecId = null;
        trackNumber = null;
      }
      pos = start; // step inside
      continue;
    }
    if (size.value === null || start + size.value > webm.length) break;
    const body = webm.subarray(start, start + size.value);
    switch (id.value) {
      case 0xd7: // TrackNumber
        trackNumber = body.readUIntBE(0, Math.min(body.length, 6));
        break;
      case ID.CodecID:
        codecId = body.toString("ascii");
        if (codecId === "A_OPUS" && trackNumber !== null) opusTrack = trackNumber;
        break;
      case ID.CodecPrivate:
        if (body.subarray(0, 8).toString("ascii") === "OpusHead") codecPrivate = Buffer.from(body);
        break;
      case ID.Channels:
        channels = body.readUIntBE(0, Math.min(body.length, 6)) || 1;
        break;
      case ID.SimpleBlock:
      case ID.Block: {
        const track = readSize(body, 0);
        if (!track || track.value === null) break;
        if (opusTrack !== null && track.value !== opusTrack) break;
        const flags = body[track.length + 2] ?? 0;
        if (flags & 0x06) return null; // laced blocks: not written by browsers for audio
        const packet = body.subarray(track.length + 3);
        if (packet.length) packets.push(Buffer.from(packet));
        break;
      }
    }
    pos = start + size.value;
    // A TrackEntry's CodecID can come before its TrackNumber.
    if (id.value === 0xd7 && codecId === "A_OPUS" && opusTrack === null) opusTrack = trackNumber;
  }

  if (codecId !== "A_OPUS" && opusTrack === null) return null;
  if (packets.length === 0) return null;
  const head = codecPrivate ?? defaultOpusHead(channels);
  const headChannels = head[9] ?? channels;

  const serial = (Math.random() * 0xffffffff) >>> 0;
  const pages: Buffer[] = [oggPage([head], 0n, serial, 0, 0x02), oggPage([opusTags()], 0n, serial, 1, 0)];
  let granule = 0n;
  let sequence = 2;
  let batch: Buffer[] = [];
  let segments = 0;
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i]!;
    const need = Math.floor(p.length / 255) + 1;
    if (batch.length && segments + need > 255) {
      pages.push(oggPage(batch, granule, serial, sequence++, 0));
      batch = [];
      segments = 0;
    }
    batch.push(p);
    segments += need;
    granule += BigInt(opusPacketSamples(p));
  }
  pages.push(oggPage(batch, granule, serial, sequence, 0x04));
  const preSkip = head.readUInt16LE(10);
  return { data: Buffer.concat(pages), channels: headChannels, durationMs: Math.max(0, Number(granule) - preSkip) / 48 };
}
