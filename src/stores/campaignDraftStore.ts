import { create } from 'zustand';

/**
 * Wizard draft state for the new-campaign flow.
 *
 * Lives in memory only — there's no value in persisting a half-filled
 * draft across an app reload (the user's already going to start over
 * anyway). Reset whenever the wizard mounts on step 1.
 */

export type ScheduleMode = 'now' | 'later';

/**
 * Allowed-window shape mirrors the backend's POST /agents/:id/launch contract
 * exactly — keys serialise straight onto the launch body. Days default to a
 * single weekday (today) for v1; the UI can broaden later without a schema
 * change. Timezone is hardcoded to Asia/Kolkata since every customer is in
 * India and the user-facing input would just be noise.
 */
export interface AllowedWindow {
  startTime: string;   // "HH:MM" — 24h
  endTime: string;     // "HH:MM" — 24h
  days: string[];      // ["Monday", ...]
  timezone: string;    // "Asia/Kolkata"
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const defaultAllowedWindow = (): AllowedWindow => ({
  startTime: '11:00',
  endTime: '19:00',
  days: [DAY_NAMES[new Date().getDay()]],
  timezone: 'Asia/Kolkata',
});

interface CampaignDraftState {
  selectedContactIds: string[];
  scheduleMode: ScheduleMode;
  scheduledAt: string | null;       // ISO string, only set when mode === 'later'
  allowedWindow: AllowedWindow;     // call-window guardrail, sent on every launch
  commonVars: Record<string, string>;

  setSelectedContactIds: (ids: string[]) => void;
  toggleContact: (id: string) => void;
  setScheduleMode: (mode: ScheduleMode) => void;
  setScheduledAt: (iso: string | null) => void;
  setAllowedWindow: (win: AllowedWindow) => void;
  patchAllowedWindow: (patch: Partial<AllowedWindow>) => void;
  setCommonVars: (vars: Record<string, string>) => void;
  reset: () => void;
}

const buildInitial = () => ({
  selectedContactIds: [] as string[],
  scheduleMode: 'now' as ScheduleMode,
  scheduledAt: null as string | null,
  allowedWindow: defaultAllowedWindow(),
  commonVars: {} as Record<string, string>,
});

export const useCampaignDraftStore = create<CampaignDraftState>((set, get) => ({
  ...buildInitial(),

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
  setAllowedWindow: (allowedWindow) => set({ allowedWindow }),
  patchAllowedWindow: (patch) =>
    set((s) => ({ allowedWindow: { ...s.allowedWindow, ...patch } })),
  setCommonVars: (commonVars) => set({ commonVars }),
  reset: () => set({ ...buildInitial() }),
}));
