import { EventEmitter } from "events";

interface IsoBox {
  type: string;
  raw: Buffer;
  data: Buffer;
}

interface TfhdInfo {
  trackId: number;
  defaultSampleFlags?: number;
}

const BOX_HEADER_SIZE = 8;
const EXTENDED_BOX_HEADER_SIZE = 16;
const SAMPLE_IS_NON_SYNC = 0x00010000;
const MAX_BOX_SIZE = 16 * 1024 * 1024;
const MAX_BUFFER_SIZE = MAX_BOX_SIZE;

/**
 * Parse a complete sequence of ISO-BMFF boxes. Incomplete or malformed input
 * is deliberately rejected rather than being interpreted with unchecked reads.
 */
function parseBoxes(data: Buffer): IsoBox[] | undefined {
  const boxes: IsoBox[] = [];
  let offset = 0;

  while (offset < data.length) {
    if (data.length - offset < BOX_HEADER_SIZE) return undefined;

    let size = data.readUInt32BE(offset);
    let headerSize = BOX_HEADER_SIZE;
    if (size === 1) {
      if (data.length - offset < EXTENDED_BOX_HEADER_SIZE) return undefined;
      const extendedSize = data.readBigUInt64BE(offset + BOX_HEADER_SIZE);
      if (
        extendedSize < BigInt(EXTENDED_BOX_HEADER_SIZE) ||
        extendedSize > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        return undefined;
      }
      size = Number(extendedSize);
      headerSize = EXTENDED_BOX_HEADER_SIZE;
    } else if (size < BOX_HEADER_SIZE) {
      return undefined;
    }

    if (size > MAX_BOX_SIZE || size > data.length - offset) return undefined;

    boxes.push({
      type: data.toString("ascii", offset + 4, offset + 8),
      raw: data.subarray(offset, offset + size),
      data: data.subarray(offset + headerSize, offset + size),
    });
    offset += size;
  }

  return boxes;
}

function boxChildren(box: IsoBox, type: string): IsoBox[] | undefined {
  const children = parseBoxes(box.data);
  return children?.filter((child) => child.type === type);
}

function readTkhdTrackId(tkhd: IsoBox): number | undefined {
  if (tkhd.data.length < 1) return undefined;
  const trackIdOffset =
    tkhd.data[0] === 1 ? 20 : tkhd.data[0] === 0 ? 12 : undefined;
  if (trackIdOffset === undefined || tkhd.data.length < trackIdOffset + 4) {
    return undefined;
  }
  return tkhd.data.readUInt32BE(trackIdOffset);
}

function hdlrIsVideo(hdlr: IsoBox): boolean {
  return (
    hdlr.data.length >= 12 && hdlr.data.toString("ascii", 8, 12) === "vide"
  );
}

/** Finds the track ID belonging to the first video track in an init segment. */
export function findVideoTrackId(init: Buffer): number | undefined {
  const topLevel = parseBoxes(init);
  const moov = topLevel?.find((box) => box.type === "moov");
  if (!moov) return undefined;

  const tracks = boxChildren(moov, "trak");
  if (!tracks) return undefined;

  for (const track of tracks) {
    const tkhd = boxChildren(track, "tkhd")?.[0];
    const mdia = boxChildren(track, "mdia")?.[0];
    const hdlr = mdia && boxChildren(mdia, "hdlr")?.[0];
    if (!tkhd || !hdlr || !hdlrIsVideo(hdlr)) continue;

    const trackId = readTkhdTrackId(tkhd);
    if (trackId !== undefined) return trackId;
  }

  return undefined;
}

function readTfhd(tfhd: IsoBox): TfhdInfo | undefined {
  if (tfhd.data.length < 8) return undefined;

  const flags = tfhd.data.readUInt32BE(0) & 0x00ffffff;
  let offset = 8;
  const skip = (length: number): boolean => {
    if (offset + length > tfhd.data.length) return false;
    offset += length;
    return true;
  };

  if (flags & 0x000001 && !skip(8)) return undefined;
  if (flags & 0x000002 && !skip(4)) return undefined;
  if (flags & 0x000008 && !skip(4)) return undefined;
  if (flags & 0x000010 && !skip(4)) return undefined;

  const info: TfhdInfo = { trackId: tfhd.data.readUInt32BE(4) };
  if (flags & 0x000020) {
    if (offset + 4 > tfhd.data.length) return undefined;
    info.defaultSampleFlags = tfhd.data.readUInt32BE(offset);
  }
  return info;
}

function sampleFlagsAreSync(flags: number): boolean {
  return (flags & SAMPLE_IS_NON_SYNC) === 0;
}

function readTrunSync(
  trun: IsoBox,
  defaultSampleFlags?: number,
): boolean | undefined {
  if (trun.data.length < 8) return undefined;

  const flags = trun.data.readUInt32BE(0) & 0x00ffffff;
  const sampleCount = trun.data.readUInt32BE(4);
  if (sampleCount === 0) return undefined;
  let offset = 8;
  const skip = (length: number): boolean => {
    if (offset + length > trun.data.length) return false;
    offset += length;
    return true;
  };

  if (flags & 0x000001 && !skip(4)) return undefined;
  let firstSampleFlags: number | undefined;
  if (flags & 0x000004) {
    if (offset + 4 > trun.data.length) return undefined;
    firstSampleFlags = trun.data.readUInt32BE(offset);
    offset += 4;
  }

  const sampleDurationSize = flags & 0x000100 ? 4 : 0;
  const sampleSizeSize = flags & 0x000200 ? 4 : 0;
  const sampleFlagsSize = flags & 0x000400 ? 4 : 0;
  const compositionOffsetSize = flags & 0x000800 ? 4 : 0;
  const sampleRecordSize =
    sampleDurationSize +
    sampleSizeSize +
    sampleFlagsSize +
    compositionOffsetSize;
  if (
    sampleRecordSize > 0 &&
    sampleCount > Math.floor((trun.data.length - offset) / sampleRecordSize)
  ) {
    return undefined;
  }

  const perSampleFlags = sampleFlagsSize
    ? trun.data.readUInt32BE(offset + sampleDurationSize + sampleSizeSize)
    : undefined;
  const sampleFlags = firstSampleFlags ?? perSampleFlags ?? defaultSampleFlags;
  return sampleFlags === undefined
    ? undefined
    : sampleFlagsAreSync(sampleFlags);
}

/**
 * Determines whether the first sample of the requested video track is sync.
 * Missing fields and malformed boxes are treated as unknown (false).
 */
export function moofFirstSampleIsSync(
  moofData: Buffer,
  videoTrackId: number,
): boolean {
  const topLevel = parseBoxes(moofData);
  const moof = topLevel?.find((box) => box.type === "moof");
  if (!moof) return false;

  const trafs = boxChildren(moof, "traf");
  if (!trafs) return false;
  for (const traf of trafs) {
    const children = parseBoxes(traf.data);
    const tfhdBox = children?.find((box) => box.type === "tfhd");
    if (!tfhdBox) continue;

    const tfhd = readTfhd(tfhdBox);
    if (!tfhd || tfhd.trackId !== videoTrackId) continue;

    for (const trun of children.filter((box) => box.type === "trun")) {
      const isSync = readTrunSync(trun, tfhd.defaultSampleFlags);
      if (isSync !== undefined) return isSync;
    }
    return false;
  }

  return false;
}

/** Incrementally groups fMP4 boxes into init segments and media fragments. */
export class Fmp4BoxStream extends EventEmitter {
  private header = Buffer.alloc(EXTENDED_BOX_HEADER_SIZE);
  private headerLength = 0;
  private currentBox?: Buffer;
  private currentBoxLength = 0;
  private expectedBoxSize?: number;
  private ftyp?: Buffer;
  private moov?: Buffer;
  private initEmitted = false;
  private styp?: Buffer;
  private sidx?: Buffer;
  private moof?: Buffer;
  private fragmentPrefix: Buffer[] = [];

  write(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.currentBox) {
        const requiredHeaderLength = this.requiredHeaderLength();
        const copied = Math.min(
          requiredHeaderLength - this.headerLength,
          chunk.length - offset,
        );
        this.header.set(
          chunk.subarray(offset, offset + copied),
          this.headerLength,
        );
        this.headerLength += copied;
        offset += copied;
        if (this.headerLength < this.requiredHeaderLength()) continue;

        const size = this.readHeaderSize();
        if (size === undefined) {
          this.failInvalidSize();
          return;
        }
        this.currentBox = Buffer.allocUnsafe(size);
        this.header.copy(this.currentBox, 0, 0, this.headerLength);
        this.currentBoxLength = this.headerLength;
        this.expectedBoxSize = size;
        this.headerLength = 0;
      }

      const remaining = this.expectedBoxSize! - this.currentBoxLength;
      if (remaining > 0) {
        const copied = Math.min(remaining, chunk.length - offset);
        this.currentBox!.set(
          chunk.subarray(offset, offset + copied),
          this.currentBoxLength,
        );
        this.currentBoxLength += copied;
        offset += copied;
      }

      if (this.currentBoxLength === this.expectedBoxSize) {
        const box = this.currentBox!;
        this.currentBox = undefined;
        this.currentBoxLength = 0;
        this.expectedBoxSize = undefined;
        this.handleBox(box);
      }
    }
  }

  push(chunk: Uint8Array): void {
    this.write(chunk);
  }

  reset(): void {
    this.headerLength = 0;
    this.currentBox = undefined;
    this.currentBoxLength = 0;
    this.expectedBoxSize = undefined;
    this.ftyp = undefined;
    this.moov = undefined;
    this.initEmitted = false;
    this.styp = undefined;
    this.sidx = undefined;
    this.moof = undefined;
    this.fragmentPrefix = [];
  }

  private requiredHeaderLength(): number {
    if (this.headerLength < BOX_HEADER_SIZE) return BOX_HEADER_SIZE;
    return this.header.readUInt32BE(0) === 1
      ? EXTENDED_BOX_HEADER_SIZE
      : BOX_HEADER_SIZE;
  }

  private readHeaderSize(): number | undefined {
    let size = this.header.readUInt32BE(0);
    let minimumSize = BOX_HEADER_SIZE;
    if (size === 1) {
      const extendedSize = this.header.readBigUInt64BE(BOX_HEADER_SIZE);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
      size = Number(extendedSize);
      minimumSize = EXTENDED_BOX_HEADER_SIZE;
    }
    if (size < minimumSize || size > MAX_BOX_SIZE || size > MAX_BUFFER_SIZE) {
      return undefined;
    }
    return size;
  }

  private handleBox(box: Buffer): void {
    const type = box.toString("ascii", 4, 8);
    switch (type) {
      case "ftyp":
        this.ftyp = box;
        this.emitInit();
        break;
      case "moov":
        this.moov = box;
        this.emitInit();
        break;
      case "styp":
        this.styp = box;
        break;
      case "sidx":
        this.sidx = box;
        break;
      case "moof":
        this.moof = box;
        this.fragmentPrefix = [this.styp, this.sidx].filter(
          (part): part is Buffer => part !== undefined,
        );
        this.styp = undefined;
        this.sidx = undefined;
        break;
      case "mdat":
        if (this.moof) {
          this.emit(
            "fragment",
            Buffer.concat([...this.fragmentPrefix, this.moof, box]),
          );
          this.moof = undefined;
          this.fragmentPrefix = [];
        }
        break;
      default:
        // Free, skip, and vendor-specific boxes are intentionally not relayed.
        break;
    }
  }

  private emitInit(): void {
    if (!this.initEmitted && this.ftyp && this.moov) {
      this.emit("init", Buffer.concat([this.ftyp, this.moov]));
      this.initEmitted = true;
    }
  }

  private failInvalidSize(): void {
    this.reset();
    if (this.listenerCount("error") > 0) {
      this.emit("error", new Error("Invalid ISO-BMFF box size"));
    }
  }
}
