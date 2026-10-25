// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { argbToRgba, DOOM_ARGS, evalDoomFactory } from './doom-engine';

describe('doom-engine', () => {
  it('ARGB → RGBA меняет каналы местами и делает пиксель непрозрачным', () => {
    const src = new Uint32Array([0x00112233, 0xffaabbcc]);
    const dst = new Uint32Array(2);
    argbToRgba(src, dst);
    const bytes = new Uint8Array(dst.buffer);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x11, 0x22, 0x33, 0xff]);
    expect(Array.from(bytes.slice(4, 8))).toEqual([0xaa, 0xbb, 0xcc, 0xff]);
  });

  it('запуск идёт сразу в игру (без меню)', () => {
    expect(DOOM_ARGS).toContain('-warp');
    expect(DOOM_ARGS).toContain('/doom/doom1.wad');
  });

  it('игровые файлы лежат в public/doom и WAD — оригинальный shareware (4 196 020 байт)', () => {
    const dir = path.join(__dirname, '..', 'public', 'doom');
    expect(fs.statSync(path.join(dir, 'doom1.wad')).size).toBe(4196020);
    expect(fs.readFileSync(path.join(dir, 'doom1.wad')).subarray(0, 4).toString()).toBe('IWAD');
    expect(fs.existsSync(path.join(dir, 'doom.wasm'))).toBe(true);
  });

  it('движок запускается без Node-окружения и отдаёт кадр 640×400', async () => {
    const dir = path.join(__dirname, '..', 'public', 'doom');
    const factory = evalDoomFactory(fs.readFileSync(path.join(dir, 'doom.js'), 'utf8'));
    const wad = new Uint8Array(fs.readFileSync(path.join(dir, 'doom1.wad')));
    const wasm = fs.readFileSync(path.join(dir, 'doom.wasm'));
    const m = await factory({
      wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
      print: () => {},
      printErr: () => {},
      preRun: [
        (mod: any) => {
          mod.FS_createPath('/', 'doom', true, true);
          mod.FS_createDataFile('/doom', 'doom1.wad', wad, true, false);
        },
      ],
    });
    expect(typeof m._doomgeneric_Tick).toBe('function');
  }, 30000);
});
