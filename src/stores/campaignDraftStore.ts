import { create } from 'zustand';

/**
 * Wizard draft state for the new-campaign flow.
 *
 * Lives in memory only — there's no value in persisting a half-filled
 * draft across an app reload (the user's already going to start over
 * anyway). Reset whenever the wizard mounts on step 1.
 */

export type ScheduleMode = 'now' | 'later';

interface CampaignDraftState {
  selectedContactIds: string[];
  scheduleMode: ScheduleMode;
  scheduledAt: string | null;       // ISO string, only set when mode === 'later'
  commonVars: Record<string, string>;

  setSelectedContactIds: (ids: string[]) => void;
  toggleContact: (id: string) => void;
  setScheduleMode: (mode: ScheduleMode) => void;
  setScheduledAt: (iso: string | null) => void;
  setCommonVars: (vars: Record<string, string>) => void;
  reset: () => void;
}

const initial = {
  selectedContactIds: [] as string[],
  scheduleMode: 'now' as ScheduleMode,
  scheduledAt: null as string | null,
  commonVars: {} as Record<string, string>,
};

export const useCampaignDraftStore = create<CampaignDraftState>((set, get) => ({
  ...initial,

  setSelectedContactIds: (ids) => set({ selectedContactIds: ids }),
  toggleContact: (id) =>
    set((s) => {
      const has = s.selectedContactIds.includes(id);
      return {
        selectedContactIds: has
          ? s.selectedContactIds.filter((x) => x !== id)
          : [...s.selectedContactIds, id],
      };
    }),
  setScheduleMode: (scheduleMode) => set({ scheduleMode }),
  setScheduledAt: (scheduledAt) => set({ scheduledAt }),
  setCommonVars: (commonVars) => set({ commonVars }),
  reset: () => set({ ...initial }),
}));
