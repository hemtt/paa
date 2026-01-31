/* tslint:disable */
/* eslint-disable */

export class FromPaaResult {
  free(): void;
  [Symbol.dispose](): void;
  constructor(s: Uint8Array);
  data_len(): number;
  data_ptr(): number;
}

export class ToPaaResult {
  free(): void;
  [Symbol.dispose](): void;
  constructor(s: Uint8Array);
  format(): string;
  data_len(): number;
  data_ptr(): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_frompaaresult_free: (a: number, b: number) => void;
  readonly __wbg_topaaresult_free: (a: number, b: number) => void;
  readonly frompaaresult_data_len: (a: number) => number;
  readonly frompaaresult_data_ptr: (a: number) => number;
  readonly frompaaresult_new: (a: any) => number;
  readonly topaaresult_data_len: (a: number) => number;
  readonly topaaresult_data_ptr: (a: number) => number;
  readonly topaaresult_format: (a: number) => [number, number];
  readonly topaaresult_new: (a: any) => number;
  readonly lzo1x_1_compress: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly lzo1x_decompress_safe: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
