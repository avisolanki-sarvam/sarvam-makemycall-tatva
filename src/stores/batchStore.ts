import { create } from 'zustand';

interface BatchConfig {
  scheduleType: 'now' | 'later' | 'recurring';
  scheduledAt?: string;
  contactIds: string[];
}

interface Batch {
  id: string;
  status: string;
  contactCount: number;
  completedCount: number;
  createdAt: string;
  totalCost: number;
}

interface BatchState {
  config: BatchConfig;
  activeBatches: Batch[];
  isLoading: boolean;

  setConfig: (config: Partial<BatchConfig>) => void;
  resetConfig: () => void;
  setBatches: (batches: Batch[]) => void;
  setLoading: (loading: boolean) => void;
}

const defaultConfig: BatchConfig = {
  scheduleType: 'now',
  contactIds: [],
};

export const useBatchStore = create<BatchState>((set) => ({
  config: { ...defaultConfig },
  activeBatches: [],
  isLoading: false,

  setConfig: (updates) =>
    set((s) => ({ config: { ...s.config, ...updates } })),
  resetConfig: () => set({ config: { ...defaultConfig } }),
  setBatches: (activeBatches) => set({ activeBatches }),
  setLoading: (isLoading) => set({ isLoading }),
}));
