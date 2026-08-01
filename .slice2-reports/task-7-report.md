# Task 7 Implementation Report: Frontend — Invitation UI

**Date:** 2026-07-31  
**Status:** DONE  
**Commit:** 360daa5

## Summary

Successfully implemented Task 7: Frontend Invitation UI components and integration into UsersListPage. All steps completed as specified in the plan, with all tests passing and build succeeding.

## Step-by-Step Execution

### Step 1: Create InvitationList.tsx

**File:** `web/src/features/org-structure/components/InvitationList.tsx`

Created component that displays a table of invitations with:
- Email column (shows "(shareable link)" for null emails)
- Type, Role, and Status columns
- Resend button (disabled for accepted invitations)
- Empty state: "No invitations yet."

**Status:** ✓ Complete

### Step 2: Create InvitationForm.tsx

**File:** `web/src/features/org-structure/components/InvitationForm.tsx`

Created form component with:
- Conditional Type selector (employee_direct vs company_admin_setup)
- Email input (required)
- Role selector (shown only for employee_direct type)
- Error display and submission feedback
- Form reset on successful submission

**Status:** ✓ Complete

### Step 3: Create ShareableLinkPanel.tsx

**File:** `web/src/features/org-structure/components/ShareableLinkPanel.tsx`

Created panel component with:
- Role selector for link configuration
- "Create shareable link" button
- Link display in code block format with full URL construction
- Error state handling

**Status:** ✓ Complete

### Step 4: Modify UsersListPage.tsx

**File:** `web/src/features/org-structure/pages/UsersListPage.tsx`

Applied the following modifications:

#### 4a. Added Imports
- Added invitations API functions: `listInvitations`, `createInvitation`, `createShareableLink`, `resendInvitation`
- Added Invitation type
- Added three invitation component imports

#### 4b. Added Invitations State
- Added `invitations` state alongside existing user state

#### 4c. Updated reload() Function
- Changed to use `Promise.all` to fetch both users and invitations in parallel
- Both datasets loaded together with single loading state

#### 4c. Added Three New Handlers

1. **handleCreateInvitation**: Calls createInvitation API with companyId, then reloads
2. **handleCreateShareableLink**: Calls createShareableLink API and returns the invitation object for URL construction
3. **handleResend**: Calls resendInvitation API then reloads

#### 4d. Added JSX Sections
- Added `<h2>Invitations</h2>` heading
- Wired InvitationForm with `allowCompanyAdminSetup={true}` (backend enforces permissions)
- Wired ShareableLinkPanel with onCreate handler
- Wired InvitationList with onResend handler

**Status:** ✓ Complete

### Step 5: Verify Manually

#### Build Verification
```
$ npm run build
✓ built in 218ms
```

**Output:**
- dist/index.html                   0.45 kB
- dist/assets/index-DGNrK5qb.css    1.78 kB
- dist/assets/index-EZ6XIUC4.js   303.77 kB

**Status:** ✓ Pass

#### Test Verification
```
$ npm test

 RUN  v4.1.10

 Test Files  6 passed (6)
      Tests  21 passed (21)
   Start at  19:50:08
   Duration  792ms
```

**Status:** ✓ Pass (all 21 tests)

### Step 6: Commit

**Command Executed:**
```bash
git add web/src/features/org-structure/components/InvitationList.tsx \
        web/src/features/org-structure/components/InvitationForm.tsx \
        web/src/features/org-structure/components/ShareableLinkPanel.tsx \
        web/src/features/org-structure/pages/UsersListPage.tsx
git commit -m "feat: add invitation UI (create, shareable link, resend) to UsersListPage"
```

**Commit Details:**
- Hash: 360daa5
- Branch: feature/org-structure-slice2
- Files Changed: 4
- Insertions: 173
- Deletions: 2
- New Files: 3

**Status:** ✓ Complete

## Verification Checklist

- [x] InvitationList.tsx created and displays invitations correctly
- [x] InvitationForm.tsx created with type selector and role selector
- [x] ShareableLinkPanel.tsx created with link generation
- [x] UsersListPage.tsx modified to import all components
- [x] Invitations state added to UsersListPage
- [x] reload() updated to fetch invitations via Promise.all
- [x] All three handlers implemented (create, shareable link, resend)
- [x] JSX sections added to display invitation management UI
- [x] npm run build succeeds with no TypeScript errors
- [x] npm test passes all tests (21/21)
- [x] Commit created with specified message

## Deviations from Plan

None. All steps followed exactly as specified in the implementation plan.

## Notes

1. **Component Reuse:** The plan noted that InvitationForm is intentionally different from UserForm (Task 6), not reusing the same pattern, as they have different requirements (type selection, different role handling).

2. **Authorization:** Both InvitationForm and ShareableLinkPanel have `allowCompanyAdminSetup` hardcoded to `true`. Per the plan, this is intentional—the backend (Task 3) enforces the actual authorization rules and returns 403 for unauthorized attempts, which surfaces through the error state UI.

3. **Error Handling:** All forms properly handle and display errors, allowing admins to see detailed feedback from the backend.

4. **State Management:** The invitations state is fetched alongside users in parallel via Promise.all, optimizing load time.

## Test Results Summary

- Build: ✓ Success
- Tests: 21/21 passing
- No TypeScript errors
- No warnings

## Task 7 Status

**COMPLETE** - All requirements met, all tests passing, code committed.

## Fix round

**Date:** 2026-07-31
**Finding fixed:** `web/src/features/org-structure/pages/UsersListPage.tsx:89-92`
(`handleResend`) and `InvitationList.tsx:28` (`onClick={() => onResend(invitation)}`) —
the resend call had no `try/catch` anywhere in the chain, so a failed resend (403 from a
cross-company CompanyAdmin, 409 for an already-accepted invitation, or a network error)
became a silent unhandled promise rejection with zero UI feedback, unlike
`handleCreateInvitation`/`handleCreateShareableLink`, which both surface backend errors
through their form's `role="alert"` error state.

### What changed

`InvitationList.tsx` is the only place in the tree where the resend button lives, so it
now owns the async call the same way `InvitationForm` and `ShareableLinkPanel` already
own their own submit/create calls:

- `onResend` prop type changed from `(invitation: Invitation) => void` to
  `(invitation: Invitation) => Promise<void>` — `UsersListPage.handleResend` already
  returned a promise and already let failures propagate (it doesn't catch, matching the
  existing `handleCreateInvitation`/`handleCreateShareableLink` convention), so no change
  was needed there.
- Added local `error` state (`role="alert"`, rendered above the table) and a
  `handleResendClick` wrapper that calls `onResend`, catches any rejection, and sets a
  human-readable error message — same pattern as `InvitationForm.handleSubmit` and
  `ShareableLinkPanel.handleCreate`.
- Added `resendingId` state so the specific row's button disables and reads
  "Resending…" while its call is in flight (prevents double-submit and gives the same
  kind of in-progress feedback the other two components already provide via
  `submitting`/`creating`), and re-enables on both success and failure.

No changes were needed to `UsersListPage.tsx` — `handleResend` already had the correct
throw-on-failure shape; the bug was that nothing downstream ever caught it.

### Tests re-run

From `web/`:

```
$ npm run build
> web@0.0.0 build
> tsc -b && vite build
...
dist/index.html                   0.45 kB │ gzip:  0.29 kB
dist/assets/index-DGNrK5qb.css    1.78 kB │ gzip:  0.81 kB
dist/assets/index-CJM695II.js   304.13 kB │ gzip: 95.21 kB
✓ built in 423ms
```

```
$ npm test
> web@0.0.0 test
> NODE_OPTIONS=--no-experimental-webstorage vitest run

 RUN  v4.1.10

 Test Files  6 passed (6)
      Tests  21 passed (21)
   Start at  19:56:48
   Duration  5.81s
```

```
$ npm run lint
> web@0.0.0 lint
> oxlint

src/features/org-structure/pages/CompaniesListPage.tsx:29:5: warning react-hooks(exhaustive-deps) [pre-existing, unrelated]
src/features/org-structure/pages/UsersListPage.tsx:41:5: warning react-hooks(exhaustive-deps) [pre-existing, unrelated]
src/features/org-structure/pages/CompanyDetailPage.tsx:35:5: warning react-hooks(exhaustive-deps) [pre-existing, unrelated]
```

`tsc -b` (part of `npm run build`) type-checks the new `Promise<void>` contract between
`UsersListPage.handleResend` and `InvitationList`'s `onResend` prop, which is the
compile-time guardrail against this class of bug recurring. There is still no
component-testing library configured in this repo (confirmed in the plan's Task 7 Step 5
note and unchanged by this fix), so `npm test` continues to cover only the API-client
layer (`invitations.test.ts` `resendInvitation` call, unaffected by this UI-only change)
— all 21 pre-existing tests plus the build and lint checks are the full covering suite
for this change.

### Commit

`web/src/features/org-structure/components/InvitationList.tsx` — fixed and committed as
a follow-up commit on top of `360daa5`.
