import { HanVietIndex, type HanVietData } from './wordMatcher';

export interface LoadedHanViet {
  data: HanVietData;
  index: HanVietIndex;
}

let loading: Promise<LoadedHanViet> | null = null;

/** The reading table is ~150 KB, so it is loaded only when a reader needs it. */
export function loadHanViet(): Promise<LoadedHanViet> {
  loading ??= import('../../data/hanviet.json').then(module => {
    const data = (module.default ?? module) as unknown as HanVietData;
    return { data, index: new HanVietIndex(data) };
  });
  return loading;
}
