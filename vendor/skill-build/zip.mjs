/**
 * A dependency-free ZIP writer, sized for one job: producing a `.skill` package
 * that Vault Operator's SkillPackageImporter can read.
 *
 * Why hand-rolled: this project has no node_modules and must stay that way, so
 * the packer cannot use JSZip. The importer, however, DOES use JSZip, and it
 * reads two things a naive writer gets wrong:
 *
 *   1. `file.dir` -- directory entries are skipped by the importer, so we emit
 *      files only and let it create parents.
 *   2. `file._data.uncompressedSize` -- the zip-bomb guard reads it and falls
 *      back to the compressed size. Both live in our headers, so the guard sees
 *      real numbers instead of 0.
 *
 * Timestamps are fixed, not `now`. A pack is then byte-reproducible, so a
 * re-pack with no source change produces an identical file and a diff means a
 * real change. `Date.now()` would make every pack look different.
 *
 * Verified against the real JSZip in tools/__tests__/zip.test.mjs.
 */

import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = buildCrcTable();

function buildCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
}

export function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// 2020-01-01 00:00:00 in the MS-DOS packed format ZIP still uses.
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

// Bit 11 declares UTF-8 filenames. Our names are ASCII, but declaring it costs
// nothing and keeps a future umlaut in an asset name from being misread.
const FLAG_UTF8 = 0x0800;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/**
 * Build a ZIP from `[{ name, data }]`, where `name` is a forward-slash path and
 * `data` is a Buffer. Entry order is preserved, so the caller decides it (we
 * sort before calling, to keep the pack reproducible).
 */
export function createZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = Buffer.from(entry.name, 'utf8');
        const raw = entry.data;
        const deflated = deflateRawSync(raw, { level: 9 });

        // Storing beats deflating on tiny or incompressible files. Picking the
        // smaller of the two keeps the archive honest rather than always larger.
        const useDeflate = deflated.length < raw.length;
        const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
        const payload = useDeflate ? deflated : raw;
        const crc = crc32(raw);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(SIG_LOCAL, 0);
        localHeader.writeUInt16LE(20, 4); // version needed
        localHeader.writeUInt16LE(FLAG_UTF8, 6);
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(DOS_TIME, 10);
        localHeader.writeUInt16LE(DOS_DATE, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(payload.length, 18);
        localHeader.writeUInt32LE(raw.length, 22);
        localHeader.writeUInt16LE(nameBytes.length, 26);
        localHeader.writeUInt16LE(0, 28); // extra field length

        locals.push(localHeader, nameBytes, payload);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(SIG_CENTRAL, 0);
        centralHeader.writeUInt16LE(20, 4); // version made by
        centralHeader.writeUInt16LE(20, 6); // version needed
        centralHeader.writeUInt16LE(FLAG_UTF8, 8);
        centralHeader.writeUInt16LE(method, 10);
        centralHeader.writeUInt16LE(DOS_TIME, 12);
        centralHeader.writeUInt16LE(DOS_DATE, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(payload.length, 20);
        centralHeader.writeUInt32LE(raw.length, 24);
        centralHeader.writeUInt16LE(nameBytes.length, 28);
        centralHeader.writeUInt16LE(0, 30); // extra
        centralHeader.writeUInt16LE(0, 32); // comment
        centralHeader.writeUInt16LE(0, 34); // disk number start
        centralHeader.writeUInt16LE(0, 36); // internal attributes
        // Unix mode 0644 for a regular file, in the high 16 bits. Multiplied,
        // not shifted: `0o100644 << 16` overflows JS's signed 32-bit bitwise
        // result and comes out negative.
        centralHeader.writeUInt32LE(0o100644 * 0x10000, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centrals.push(centralHeader, nameBytes);

        offset += localHeader.length + nameBytes.length + payload.length;
    }

    const centralBuf = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4); // this disk
    eocd.writeUInt16LE(0, 6); // disk with central directory
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...locals, centralBuf, eocd]);
}
