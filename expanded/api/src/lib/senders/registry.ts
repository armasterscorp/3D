// apps/api/src/lib/senders/registry.ts
import { v4 as uuidv4 } from 'uuid';
import type { DirectMxConfig } from './types';
import { DirectMxSender } from './directMxSender';

type StoredSender = { id: string; type: 'direct-mx'; config: DirectMxConfig; createdAt: string };

const STORE: StoredSender[] = []; // in-memory; replace with DB calls (Prisma) if desired

export const SenderRegistry = {
  async list() {
    return STORE.slice();
  },

  async upsertDirectMx(cfg: DirectMxConfig & { id?: string }) {
    if (cfg.id) {
      const idx = STORE.findIndex((s) => s.id === cfg.id && s.type === 'direct-mx');
      if (idx >= 0) {
        STORE[idx].config = { ...cfg };
        return STORE[idx];
      }
    }
    const id = cfg.id || uuidv4();
    const stored: StoredSender = { id, type: 'direct-mx', config: { ...cfg, id }, createdAt: new Date().toISOString() };
    STORE.push(stored);
    return stored;
  },

  async getById(id: string) {
    return STORE.find((s) => s.id === id) || null;
  },

  createInstance(stored: StoredSender) {
    if (stored.type === 'direct-mx') {
      return new DirectMxSender(stored.config as DirectMxConfig);
    }
    throw new Error(`Unsupported sender type ${stored.type}`);
  },
};
