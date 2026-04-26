import { IndexedDbGraphRepository } from './indexeddb';
import type { GraphRepository } from './repository';
import { isVsCodeWebview, VsCodeGraphRepository } from './vscoderepository';

export function createDefaultRepository(): GraphRepository {
  if (isVsCodeWebview()) {
    return new VsCodeGraphRepository();
  }

  return new IndexedDbGraphRepository();
}