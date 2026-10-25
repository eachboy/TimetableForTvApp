/**
 * Doom (doomgeneric → WebAssembly) в браузере/WebView. Всё лежит локально в public/doom
 * (doom.js, doom.wasm, doom1.wad) — интернет не нужен.
 *
 * Сборка doom.js сделана для Node.js (ссылается на fs/path/crypto), поэтому загружаем её с
 * небольшой заглушкой окружения: wasm и WAD передаём готовыми байтами, файловая система виртуальная.
 *
 * Лицензии: движок — GPL-2.0 (id Software / doomgeneric), DOOM1.WAD — shareware-версия,
 * разрешённая к свободному распространению.
 */

export interface DoomModule {
  _doomgeneric_Create: (argc: number, argv: number) => void;
  _doomgeneric_Tick: () => void;
  _DG_GetFrameBuffer: () => number;
  _DG_GetScreenWidth: () => number;
  _DG_GetScreenHeight: () => number;
  _DG_PushKeyEvent: (pressed: number, key: number) => void;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  HEAPU8: Uint8Array;
  FS_createDataFile: (parent: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean) => void;
  FS_createPath: (parent: string, path: string, canRead: boolean, canWrite: boolean) => string;
}

/** Коды клавиш из doomkeys.h */
export const DoomKeys = {
  RIGHT: 0xae,
  LEFT: 0xac,
  UP: 0xad,
  DOWN: 0xaf,
  USE: 0xa2,
  FIRE: 0xa3,
  ENTER: 13,
  ESCAPE: 27,
  RSHIFT: 0x80 + 0x36,
} as const;

/** Аргументы запуска: сразу в игру (E1M1, средняя сложность), без меню — клавиш для него нет. */
export const DOOM_ARGS = ['doom', '-iwad', '/doom/doom1.wad', '-skill', '3', '-warp', '1', '1'];

type Factory = (config: Record<string, unknown>) => Promise<DoomModule>;

/** Загрузка Node-сборки Emscripten в браузере. Вынесено отдельно для тестов. */
export function evalDoomFactory(code: string): Factory {
  const stubFs = {
    readFileSync() {
      throw new Error('fs is not available in the browser');
    },
    readSync() {
      throw new Error('fs is not available in the browser');
    },
  };
  const stubRequire = (name: string): unknown => {
    const n = name.replace(/^node:/, '');
    if (n === 'fs') return stubFs;
    if (n === 'path') return { normalize: (p: string) => p, join: (...p: string[]) => p.join('/') };
    if (n === 'crypto') {
      return { randomFillSync: (view: Uint8Array) => globalThis.crypto.getRandomValues(view) };
    }
    throw new Error(`module ${name} is not available in the browser`);
  };
  const stubProcess = { argv: ['doom'], exitCode: 0, platform: 'browser', env: {}, on() {}, stdin: { fd: 0 } };
  const mod: { exports: unknown } = { exports: {} };
  // eslint-disable-next-line no-new-func
  const run = new Function('module', 'exports', '__dirname', '__filename', 'require', 'process', code);
  run(mod, mod.exports, '/doom', '/doom/doom.js', stubRequire, stubProcess);
  return mod.exports as Factory;
}

/** ARGB (как отдаёт doomgeneric) → RGBA для ImageData, на месте над Uint32Array. */
export function argbToRgba(src: Uint32Array, dst: Uint32Array): void {
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    // little-endian: байты RGBA = A<<24 | B<<16 | G<<8 | R
    dst[i] = (0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff)) >>> 0;
  }
}

export class DoomEngine {
  width = 640;
  height = 400;
  private frameBufferPtr = 0;
  private image: ImageData | null = null;

  private constructor(private module: DoomModule) {}

  static async load(base = '/doom'): Promise<DoomEngine> {
    const [js, wasm, wad] = await Promise.all([
      fetch(`${base}/doom.js`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`doom.js: ${r.status}`)))),
      fetch(`${base}/doom.wasm`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`doom.wasm: ${r.status}`)))),
      fetch(`${base}/doom1.wad`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`doom1.wad: ${r.status}`)))),
    ]);
    const wadBytes = new Uint8Array(wad);
    const factory = evalDoomFactory(js);
    const doomModule = await factory({
      wasmBinary: wasm,
      print: () => {},
      printErr: () => {},
      preRun: [
        (m: DoomModule) => {
          m.FS_createPath('/', 'doom', true, true);
          m.FS_createDataFile('/doom', 'doom1.wad', wadBytes, true, false);
        },
      ],
    });
    const engine = new DoomEngine(doomModule);
    engine.start();
    return engine;
  }

  private start(): void {
    const m = this.module;
    const ptrs = DOOM_ARGS.map((arg) => {
      const bytes = new TextEncoder().encode(arg);
      const p = m._malloc(bytes.length + 1);
      m.HEAPU8.set(bytes, p);
      m.HEAPU8[p + bytes.length] = 0;
      return p;
    });
    const argv = m._malloc(ptrs.length * 4);
    const view = new DataView(m.HEAPU8.buffer);
    ptrs.forEach((p, i) => view.setUint32(argv + i * 4, p, true));
    m._doomgeneric_Create(DOOM_ARGS.length, argv);
    ptrs.forEach((p) => m._free(p));
    m._free(argv);
    this.frameBufferPtr = m._DG_GetFrameBuffer();
    this.width = m._DG_GetScreenWidth();
    this.height = m._DG_GetScreenHeight();
  }

  /** Один игровой такт (Doom рассчитан на 35 в секунду). */
  tick(): void {
    this.module._doomgeneric_Tick();
  }

  pushKey(pressed: boolean, key: number): void {
    this.module._DG_PushKeyEvent(pressed ? 1 : 0, key);
  }

  /** Рисует текущий кадр на canvas. */
  draw(ctx: CanvasRenderingContext2D): void {
    const n = this.width * this.height;
    if (!this.image || this.image.width !== this.width) {
      this.image = ctx.createImageData(this.width, this.height);
    }
    const src = new Uint32Array(this.module.HEAPU8.buffer, this.frameBufferPtr, n);
    argbToRgba(src, new Uint32Array(this.image.data.buffer));
    ctx.putImageData(this.image, 0, 0);
  }
}
