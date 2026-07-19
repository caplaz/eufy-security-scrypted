import {
  Fmp4BoxStream,
  findVideoTrackId,
  moofFirstSampleIsSync,
} from "../src";

const box = (type: string, payload: Uint8Array = Buffer.alloc(0)): Buffer => {
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, "ascii");
  result.set(payload, 8);
  return result;
};

const fullBox = (
  type: string,
  flags: number,
  payload: Uint8Array = Buffer.alloc(0),
): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(flags, 0);
  return box(type, Buffer.concat([header, payload]));
};

const tkhd = (trackId: number, version = 0): Buffer => {
  const payload = Buffer.alloc(version === 1 ? 24 : 16);
  payload[0] = version;
  payload.writeUInt32BE(trackId, version === 1 ? 20 : 12);
  return box("tkhd", payload);
};

const hdlr = (handlerType: string): Buffer => {
  const payload = Buffer.alloc(12);
  payload.write(handlerType, 8, 4, "ascii");
  return box("hdlr", payload);
};

const trak = (trackId: number, handlerType: string, version = 0): Buffer =>
  box("trak", Buffer.concat([tkhd(trackId, version), box("mdia", hdlr(handlerType))]));

const tfhd = (trackId: number, defaultSampleFlags?: number): Buffer => {
  const hasDefaultFlags = defaultSampleFlags !== undefined;
  const payload = Buffer.alloc(hasDefaultFlags ? 8 : 4);
  payload.writeUInt32BE(trackId, 0);
  if (hasDefaultFlags) payload.writeUInt32BE(defaultSampleFlags, 4);
  return fullBox("tfhd", hasDefaultFlags ? 0x20 : 0, payload);
};

const trun = (options: {
  sampleCount?: number;
  firstSampleFlags?: number;
  sampleFlags?: number;
} = {}): Buffer => {
  const sampleCount = options.sampleCount ?? 1;
  const hasFirstSampleFlags = options.firstSampleFlags !== undefined;
  const hasSampleFlags = options.sampleFlags !== undefined;
  const payload = Buffer.alloc(
    4 + (hasFirstSampleFlags ? 4 : 0) + (hasSampleFlags ? 4 * sampleCount : 0),
  );
  payload.writeUInt32BE(sampleCount, 0);
  let offset = 4;
  if (hasFirstSampleFlags) {
    payload.writeUInt32BE(options.firstSampleFlags!, offset);
    offset += 4;
  }
  if (hasSampleFlags) payload.writeUInt32BE(options.sampleFlags!, offset);
  return fullBox(
    "trun",
    (hasFirstSampleFlags ? 0x4 : 0) | (hasSampleFlags ? 0x400 : 0),
    payload,
  );
};

const traf = (trackId: number, run: Buffer, defaultSampleFlags?: number): Buffer =>
  box("traf", Buffer.concat([tfhd(trackId, defaultSampleFlags), run]));

describe("Fmp4BoxStream", () => {
  it("emits init and fragments when every byte arrives in its own chunk", () => {
    const stream = new Fmp4BoxStream();
    const init = Buffer.concat([box("ftyp", Buffer.from("isom")), box("moov")]);
    const fragment = Buffer.concat([
      box("styp"),
      box("sidx"),
      box("moof", Buffer.from([1, 2])),
      box("mdat", Buffer.from([3, 4, 5])),
    ]);
    const inits: Buffer[] = [];
    const fragments: Buffer[] = [];
    stream.on("init", (data: Buffer) => inits.push(data));
    stream.on("fragment", (data: Buffer) => fragments.push(data));

    for (const byte of Buffer.concat([init, fragment])) stream.write(Buffer.from([byte]));

    expect(inits).toEqual([init]);
    expect(fragments).toEqual([fragment]);
  });

  it("drops unknown boxes without preventing later init or fragment output", () => {
    const stream = new Fmp4BoxStream();
    const init = Buffer.concat([box("ftyp"), box("moov")]);
    const fragment = Buffer.concat([box("styp"), box("moof"), box("mdat")]);
    const inits: Buffer[] = [];
    const fragments: Buffer[] = [];
    stream.on("init", (data: Buffer) => inits.push(data));
    stream.on("fragment", (data: Buffer) => fragments.push(data));

    stream.write(Buffer.concat([box("free"), init, box("free"), fragment, box("free")]));

    expect(inits).toEqual([init]);
    expect(fragments).toEqual([fragment]);
  });

  it("emits an error and clears partial state for an invalid box size", () => {
    const stream = new Fmp4BoxStream();
    const errors: Error[] = [];
    const fragments: Buffer[] = [];
    stream.on("error", (error: Error) => errors.push(error));
    stream.on("fragment", (data: Buffer) => fragments.push(data));

    const partial = Buffer.concat([box("styp"), box("moof")]);
    stream.write(partial);
    const invalid = Buffer.alloc(8);
    invalid.writeUInt32BE(7, 0);
    invalid.write("free", 4, 4, "ascii");
    stream.write(invalid);
    stream.write(box("mdat"));

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/invalid.*size/i);
    expect(fragments).toEqual([]);
  });

  it("resets malformed input without throwing when no error listener is registered", () => {
    const stream = new Fmp4BoxStream();
    const invalid = Buffer.alloc(8);
    invalid.writeUInt32BE(7, 0);
    invalid.write("free", 4, 4, "ascii");

    expect(() => stream.write(invalid)).not.toThrow();
    expect(() => stream.write(box("ftyp"))).not.toThrow();
  });

  it("rejects oversized 32-bit and extended-size box declarations before buffering payloads", () => {
    const stream = new Fmp4BoxStream();
    const errors: Error[] = [];
    stream.on("error", (error: Error) => errors.push(error));

    const oversized = Buffer.alloc(8);
    oversized.writeUInt32BE(0xffffffff, 0);
    oversized.write("free", 4, 4, "ascii");
    stream.write(oversized);

    const extended = Buffer.alloc(16);
    extended.writeUInt32BE(1, 0);
    extended.write("free", 4, 4, "ascii");
    extended.writeBigUInt64BE(0x100000000n, 8);
    stream.write(extended);

    expect(errors).toHaveLength(2);
    expect(errors.every((error) => /invalid.*size/i.test(error.message))).toBe(true);
  });

  it("reset discards buffered bytes and incomplete boxes", () => {
    const stream = new Fmp4BoxStream();
    const inits: Buffer[] = [];
    stream.on("init", (data: Buffer) => inits.push(data));

    const ftyp = box("ftyp");
    stream.write(ftyp.subarray(0, 5));
    stream.reset();
    stream.write(box("moov"));
    expect(inits).toEqual([]);

    stream.write(Buffer.concat([box("ftyp"), box("moov")]));
    expect(inits).toEqual([Buffer.concat([box("ftyp"), box("moov")])]);
  });

  it("assembles fragmented large boxes without repeated Buffer.concat calls", () => {
    const stream = new Fmp4BoxStream();
    const free = box("free", Buffer.alloc(512 * 1024, 0xab));
    const concatSpy = jest.spyOn(Buffer, "concat");

    try {
      for (let offset = 0; offset < free.length; offset += 4096) {
        stream.write(free.subarray(offset, offset + 4096));
      }
      expect(concatSpy).not.toHaveBeenCalled();
    } finally {
      concatSpy.mockRestore();
    }
  });
});

describe("findVideoTrackId", () => {
  it("finds a video track ID from version 0 and version 1 tkhd boxes", () => {
    const version0 = Buffer.concat([box("ftyp"), box("moov", Buffer.concat([trak(3, "soun"), trak(42, "vide")]))]);
    const version1 = Buffer.concat([box("ftyp"), box("moov", trak(99, "vide", 1))]);

    expect(findVideoTrackId(version0)).toBe(42);
    expect(findVideoTrackId(version1)).toBe(99);
  });

  it("returns undefined when an init segment has no video track", () => {
    const init = Buffer.concat([box("ftyp"), box("moov", trak(3, "soun"))]);
    expect(findVideoTrackId(init)).toBeUndefined();
  });
});

describe("moofFirstSampleIsSync", () => {
  it("uses the matching video traf rather than an audio traf that appears first", () => {
    const audio = traf(1, trun({ firstSampleFlags: 0 }));
    const video = traf(2, trun({ firstSampleFlags: 0x00010000 }));
    const moof = box("moof", Buffer.concat([audio, video]));
    expect(moofFirstSampleIsSync(moof, 2)).toBe(false);
  });

  it("recognizes sync samples from trun flags and tfhd defaults", () => {
    const fromPerSampleFlags = box("moof", traf(2, trun({ sampleFlags: 0 })));
    const fromDefaultFlags = box("moof", traf(2, trun(), 0));

    expect(moofFirstSampleIsSync(fromPerSampleFlags, 2)).toBe(true);
    expect(moofFirstSampleIsSync(fromDefaultFlags, 2)).toBe(true);
  });

  it("returns false when a matching sample cannot be proven sync", () => {
    const noVideo = box("moof", traf(1, trun({ firstSampleFlags: 0 })));
    const noFlags = box("moof", traf(2, trun()));

    expect(moofFirstSampleIsSync(noVideo, 2)).toBe(false);
    expect(moofFirstSampleIsSync(noFlags, 2)).toBe(false);
  });

  it("returns false when a multi-sample trun omits later declared sample records", () => {
    const payload = Buffer.alloc(8);
    payload.writeUInt32BE(2, 0);
    payload.writeUInt32BE(0, 4);
    const truncatedFlags = fullBox("trun", 0x400, payload);
    const moof = box("moof", traf(2, truncatedFlags));

    expect(moofFirstSampleIsSync(moof, 2)).toBe(false);
  });
});
