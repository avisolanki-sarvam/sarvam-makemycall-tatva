# MakeMyCall — Mobile App Memory

> Read this first on every session. Update when state materially changes.

## What this codebase is

The Android client for MakeMyCall, an AI phone-calling assistant for Indian
small business owners. The user describes their business in plain language
(text or voice), the app provisions an AI agent on Sarvam Samvaad, the user
uploads contacts, schedules a batch, Samvaad makes the calls. Results come
back via webhooks and are summarised in plain Hindi/English.

Phone numbers are pre-provisioned on Samvaad and assigned to agents — we
don't manage telephony.

## Stack

- **Mobile**: Expo SDK 54, React Native 0.81, expo-router, Zustand
- **Auth**: Firebase phone OTP (`@react-native-firebase/auth`)
- **Persistence**: `expo-secure-store` for tokens (lazy-loaded with a probe
  so missing native module degrades gracefully instead of crashing boot)
- **Phone-book import**: `expo-contacts` (lazy-loaded, needs dev-client rebuild)

## Backend

Lives in `sarvam-makemycall-service` (separate repo, deployed to Railway).
This codebase doesn't ship server code — it talks to the API over HTTPS.

`API_BASE_URL` lives in `src/constants/api.ts`:
- **Dev**: `http://10.0.2.2:3000` (Android emulator → host)
- **Prod**: `https://<your-railway-app>.up.railway.app`

## Repo layout (only what matters)

```
sarvam-makemycall/
├── app/                          # Expo Router screens
│   ├── _layout.tsx               # passive Stack — does NOT auto-redirect on auth state
│   ├── index.tsx                 # redirects based on isLoggedIn / onboardingDone
│   ├── profile-setup.tsx         # 2-step onboarding (profile → description → create agent)
│   ├── (auth)/login.tsx          # phone entry
│   ├── (auth)/verify-otp.tsx     # OTP screen — single hidden input + 6 visual boxes
│   ├── (tabs)/                   # index (home), contacts, history (campaigns), settings
│   └── campaigns/                # new (wizard), [id] (detail), [id]/calls/[callId]
├── src/
│   ├── stores/                   # Zustand: authStore, contactStore, campaignDraftStore
│   ├── services/                 # api.ts (fetch + JWT refresh), contactImport.ts
│   └── constants/api.ts          # API_BASE_URL + COLORS palette
├── android/                      # Native Android project (committed)
├── assets/                       # Icons + splash + fonts
├── google-services.json          # Firebase client config — gitignored, secure-share only
├── package.json
└── README.md
```

## What's built and shipping

- Phone OTP login → JWT pair issued + persisted (test number `+91 9999999999 → 123456`)
- Profile setup (name, business desc, language picker) + agent creation
- Home dashboard (credits, agent card, recent campaign card)
- Contacts: list + add (with key-value `customFields` + Notes textarea + suggestion chips)
  + phone-book import via `expo-contacts` → `/contacts/bulk` (multi-select picker)
- New-campaign wizard (single screen, internal stepper):
  contacts → schedule → variables → review + Launch
- Campaigns tab: list + detail (KPI tiles + auto-poll while active + cancel)
- Call detail with transcript + outcome chip + summary

## Important behavioural quirks

1. **The root layout does not auto-redirect on auth state changes.** Both
   `verify-otp.tsx` and `profile-setup.tsx` explicitly call
   `router.replace()` after success. Don't rely on `app/index.tsx`
   redirects after the initial mount.
2. **OTP screen architecture**: single hidden TextInput + 6 visual boxes.
   `onKeyPress` for Backspace is unreliable on Android with soft
   keyboards — the pattern detects deletes via length-shrink in
   `onChangeText`. Don't revert.
3. **Native modules are lazy-loaded with a probe pattern** (see
   `authStore.ts` and `contactImport.ts`). Missing dev-client just
   degrades gracefully — boot doesn't crash.
4. **`expo-contacts` requires a dev-client rebuild** (`npx expo prebuild
   --platform android && npx expo run:android`) since it's a native module.
   The lazy probe makes the JS safe regardless.
5. **Editorial cream + ink black palette only.** No indigo/purple/blue
   anywhere. Status chips use sage / tan / rust / mute. Voice is
   Hinglish-friendly: "AI phone secretary", "When should I call?" — never
   "agent / campaign / batch" in user-facing copy.

## Conventions

- camelCase in JSON request/response keys (matches backend).
- No emojis in code unless explicitly asked.
- Hindi-first language defaults; real users will be Indian SMBs.

## Reference artifacts

- **makemycall-status** — running build status across mobile + backend
- **makemycall-deploy** — repo split + Railway plan
- **makemycall-secrets** — secrets handling (rare — mostly applies to backend)
