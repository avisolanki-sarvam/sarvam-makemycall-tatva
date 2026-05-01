import { create } from 'zustand';

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  tags?: string[];
  notes?: string;
  /**
   * Free-form per-contact metadata. Keys + values are user-typed strings — no
   * schema. The LLM normalises at call-script-generation time. Examples:
   *   { "pending": "2400", "due_date": "Diwali" }
   *   { "last_visit": "March", "preferred_time": "evening" }
   */
  customFields?: Record<string, string>;
  lastCalled?: string;
}

interface ContactState {
  contacts: Contact[];
  selectedIds: Set<string>;
  searchQuery: string;
  isLoading: boolean;

  setContacts: (contacts: Contact[]) => void;
  addContact: (contact: Contact) => void;
  /** Replace the matching contact in-place (id-keyed). Used by the
   *  contact-edit screen after PUT /contacts/:id resolves. */
  updateContact: (contact: Contact) => void;
  removeContact: (id: string) => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;
  getFilteredContacts: () => Contact[];
  getSelectedContacts: () => Contact[];
}

export const useContactStore = create<ContactState>((set, get) => ({
  contacts: [],
  selectedIds: new Set(),
  searchQuery: '',
  isLoading: false,

  setContacts: (contacts) => set({ contacts }),
  addContact: (contact) => set((s) => ({ contacts: [...s.contacts, contact] })),
  updateContact: (contact) =>
    set((s) => ({
      contacts: s.contacts.map((c) => (c.id === contact.id ? contact : c)),
    })),
  removeContact: (id) => set((s) => ({ contacts: s.contacts.filter((c) => c.id !== id) })),

  toggleSelection: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),

  selectAll: () =>
    set((s) => ({ selectedIds: new Set(s.contacts.map((c) => c.id)) })),

  clearSelection: () => set({ selectedIds: new Set() }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setLoading: (isLoading) => set({ isLoading }),

  getFilteredContacts: () => {
    const { contacts, searchQuery } = get();
    if (!searchQuery) return contacts;
    const q = searchQuery.toLowerCase();
    return contacts.filter(
      (c) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q)
    );
  },

  getSelectedContacts: () => {
    const { contacts, selectedIds } = get();
    return contacts.filter((c) => selectedIds.has(c.id));
  },
}));
