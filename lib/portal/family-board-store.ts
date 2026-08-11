/**
 * 家庭家务板上次快照 —— IDB durable。
 * 今天页不能每次都等 /api 才画出家务;sessionStorage 5 分钟 TTL 杀进程就没了。
 */
import { createBlobStore } from './idb-blob-store';
import { reportStorageDropped } from './storage-health';
import type { BoardView } from '@/lib/family/family-client';

export const FAMILY_BOARD_KEY = 'nesio-family-board-v1';
export const FAMILY_BOARD_UPDATED = 'nesio-family-board-updated';

export type FamilyBoardSnap = BoardView & { familyName: string };

const store = createBlobStore<FamilyBoardSnap[]>({
  key: FAMILY_BOARD_KEY,
  updateEvent: FAMILY_BOARD_UPDATED,
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

export function loadFamilyBoards(): FamilyBoardSnap[] {
  return store.load() ?? [];
}

export function saveFamilyBoards(boards: FamilyBoardSnap[]): void {
  store.save(boards);
}
