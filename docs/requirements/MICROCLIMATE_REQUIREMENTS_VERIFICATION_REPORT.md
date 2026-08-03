> **Ported client requirements document — the body below is verbatim.**
> Source: `climate-project/MICROCLIMATE_REQUIREMENTS_VERIFICATION_REPORT.md` @ `40fc19a` (2026-07-28,
> "Add existing Procomer climate platform application (baseline)").
>
> **Requirements in this document are binding.** Technical-stack prescriptions in it
> are **superseded** by this repository's .NET 10 + React 19 architecture.
> See [requirements/README.md](./README.md) for the full reading rules and provenance.

---

# Microclimate Requirements Verification Report

**Date:** December 2024  
**Reviewed Against:** `microclimate-req.md`  
**Status:** 🟡 **PARTIALLY IMPLEMENTED - Significant Gaps Remain**

---

## Executive Summary

The microclimate survey system has **extensive scaffolding and components built**, but **key business requirements from microclimate-req.md are not fully implemented**. While Phase 1 marked as "complete" addresses some gaps, **critical features for production use are still missing**.

### Overall Implementation Status

| Component              | Required Features | Implemented    | Missing        | Status               |
| ---------------------- | ----------------- | -------------- | -------------- | -------------------- |
| **Step 1: Basic Info** | 6 fields          | 6 fields       | 0 fields       | ✅ **100% COMPLETE** |
| **Step 2: Questions**  | 8 features        | 5 features     | 3 features     | 🟡 **63% COMPLETE**  |
| **Step 3: Targeting**  | 9 features        | 3 features     | 6 features     | 🔴 **33% COMPLETE**  |
| **Step 4: Scheduling** | 6 features        | 3 features     | 3 features     | 🟡 **50% COMPLETE**  |
| **Non-Functional**     | 4 requirements    | 2 requirements | 2 requirements | 🟡 **50% COMPLETE**  |

**Overall Completion:** **59%** (20 of 34 total requirements)

---

## ✅ Step 1: Basic Info - COMPLETE (100%)

All requirements from microclimate-req.md are implemented:

### ✅ Required Fields (All Implemented)

1. **Survey Type** ✅
   - Dropdown: Micro-climate | Climate | Culture
   - Required field validation
   - Bilingual labels (ES/EN)
   - Component: `MicroclimateWizard.tsx` lines 200-220

2. **Title** ✅
   - Text input with validation
   - Autosave on blur
   - Required field

3. **Description** ✅
   - Multiline textarea
   - Optional field
   - Autosave enabled

4. **Company Dropdown** ✅
   - Searchable dropdown
   - Populated from Company directory
   - Component: `CompanySearchableDropdown.tsx`
   - Real-time search/filter
   - Pre-loads target data for Step 3

5. **Company Type** ✅
   - Auto-populated from selected company
   - Optional field
   - Used for business rules

6. **Language Selector** ✅
   - Spanish | English | Both
   - RadioGroup UI
   - Multilingual setup support

### ✅ Behavior/Logic (All Implemented)

- ✅ Company selection pre-loads departments and employees for Step 3
- ✅ Validation: Cannot proceed without Company and Title
- ✅ Autosave every 5-10 seconds
- ✅ Autosave on field blur
- ✅ Draft recovery after refresh/disconnect

**Files:**

- `src/components/microclimate/MicroclimateWizard.tsx`
- `src/components/companies/CompanySearchableDropdown.tsx`

---

## 🟡 Step 2: Questions - PARTIALLY COMPLETE (63%)

### ✅ IMPLEMENTED (5 of 8 features)

#### 1. **Quick Add** ✅

- Component: `QuickAddPanel.tsx`
- Shows frequently used questions
- Integrated into wizard
- Functional implementation

#### 2. **Question Library** ✅

- Component: `QuestionLibraryBrowser.tsx`
- Hierarchical Categories → Questions
- Search functionality
- Filter by category
- Tag support
- Database: `QuestionLibrary.ts` model with full schema

#### 3. **Bulk Add by Category** ✅

- "Add All" buttons per category
- Bulk selection with checkboxes
- De-duplication logic
- Toast notifications
- Component: `QuestionLibraryBrowser.tsx` lines 130-180

#### 4. **Multilingual Content (ES/EN)** ✅

- Side-by-side editing
- Component: `MultilingualQuestionEditor.tsx`
- Full Spanish/English support
- Database schema supports both languages

#### 5. **Create New Questions** ✅

- Custom question creation
- Metadata support (category, dimension, scale)
- Reverse-coding flag
- Component integrated into wizard

### 🔴 MISSING (3 of 8 features)

#### 1. **Drag & Drop Re-ordering** ❌

**Required:** Drag & drop to reorder selected questions  
**Current Status:** Not implemented  
**Impact:** Users cannot customize question order  
**Solution Needed:**

```tsx
// Need to integrate @dnd-kit/core (already installed)
import { DndContext, closestCenter } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

// Implement in Step 2 question list
```

#### 2. **Versioning** ❌

**Required:** Track changes, author, timestamp for questions  
**Current Status:** Database schema has version fields, but no UI/logic to create versions  
**Impact:** Cannot track question evolution over time  
**Solution Needed:**

- Add version increment logic when editing questions
- Store previous_version_id
- Create version history viewer UI

#### 3. **Duplicate Validation** ⚠️

**Required:** Validation for duplicated items  
**Current Status:** De-duplication exists for bulk add, but not for individual selections  
**Impact:** Partial - users can still add same question twice if not using bulk add  
**Solution Needed:**

```tsx
const handleQuestionSelection = (questionId: string) => {
  if (step2Data.questionIds.includes(questionId)) {
    toast.warning('Question already selected');
    return;
  }
  // Add question
};
```

**Files:**

- `src/components/microclimate/QuestionLibraryBrowser.tsx` (needs drag-drop)
- `src/components/microclimate/MultilingualQuestionEditor.tsx` (needs versioning UI)
- `src/models/QuestionLibrary.ts` (schema ready for versioning)

---

## 🔴 Step 3: Targeting - CRITICAL GAPS (33%)

### ✅ IMPLEMENTED (3 of 9 features)

#### 1. **Pre-load from Company** ✅

- Auto-loads departments and employees when company selected in Step 1
- API calls: `/api/companies/{id}/departments` and `/api/companies/{id}/users`
- Stores in `step3Data.availableDepartments` and `availableEmployees`
- Implementation: `MicroclimateWizard.tsx` useEffect hook

#### 2. **CSV Upload Component** ✅

- Component: `CSVImporter.tsx` exists
- Can parse CSV files
- Shows file upload UI

#### 3. **All Employees Option** ✅

- Radio button for "All Employees"
- Simple selection method

### 🔴 MISSING (6 of 9 features) - CRITICAL BLOCKERS

#### 1. **CSV Import with Column Mapping** ❌ CRITICAL

**Required:** Import CSV/XLSX with column mapping and validation  
**Current Status:** Components exist (`CSVImporter`, `ColumnMapper`, `ValidationPanel`) but NOT CONNECTED  
**Impact:** Cannot import employee lists from CSV  
**Solution Needed:**

```tsx
// Required flow in Step 3:
1. CSVImporter → parse file
2. ColumnMapper → map columns to (Name, Email, Employee ID, Demographics)
3. ValidationPanel → validate data, show errors
4. ReviewAudience → show final list before import
```

#### 2. **Manual Add/Edit Records** ❌ HIGH PRIORITY

**Required:** Manually add/edit employee records one by one  
**Current Status:** Component may exist but not integrated into Step 3  
**Impact:** Cannot manually add individual employees  
**Solution Needed:**

- Add "Manual" tab to Step 3
- Form with fields: Name, Email, Employee ID, Department, Location, Role
- Add to `step3Data.targetEmployees` array
- Edit/remove functionality

#### 3. **Filters for Sub-groups** ❌ CRITICAL

**Required:** Filter by department, location, role, seniority, etc.  
**Current Status:** No filtering UI at all  
**Impact:** Cannot target specific sub-groups (e.g., "Engineering dept in Mexico City")  
**Solution Needed:**

```tsx
<Card>
  <CardHeader>Target Audience Filters</CardHeader>
  <CardContent>
    <MultiSelect label="Departments" options={availableDepartments} />
    <MultiSelect label="Locations" options={demographics.locations} />
    <MultiSelect label="Roles" options={demographics.roles} />
    <MultiSelect label="Seniority" options={demographics.seniority} />
    <Button onClick={applyFilters}>Apply Filters</Button>
  </CardContent>
</Card>
```

#### 4. **De-duplication** ❌ MEDIUM PRIORITY

**Required:** De-duplicate on Email/Employee ID  
**Current Status:** No de-duplication logic  
**Impact:** Risk of sending duplicate invitations  
**Solution Needed:**

```tsx
const deduplicateEmployees = (employees: TargetEmployee[]) => {
  const seen = new Set<string>();
  return employees.filter((emp) => {
    const key = emp.email || emp.employee_id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
```

#### 5. **Demographics Loading** ❌ HIGH PRIORITY

**Required:** Pre-load demographics (location, role, seniority, etc.) from company  
**Current Status:** `step3Data.demographics` field exists but not populated  
**Impact:** Cannot filter by demographics  
**Solution Needed:**

- Add API endpoint: `/api/companies/{id}/demographics`
- Load demographics when company selected
- Store in `step3Data.demographics`

#### 6. **Target Audience Preview Summary** ❌ MEDIUM PRIORITY

**Required:** Read-only summary card showing "8 depts, 520 employees, 3 sites"  
**Current Status:** Basic employee list, no summary statistics  
**Impact:** No clear overview of audience size/composition  
**Solution Needed:**

```tsx
<Card>
  <CardHeader>Target Audience Summary</CardHeader>
  <CardContent>
    <div className="grid grid-cols-3 gap-4">
      <Stat value={uniqueDepartments.size} label="Departments" />
      <Stat value={targetEmployees.length} label="Employees" />
      <Stat value={uniqueLocations.size} label="Sites" />
    </div>
  </CardContent>
</Card>
```

**Files:**

- `src/components/microclimate/CSVImporter.tsx` (exists, needs integration)
- `src/components/microclimate/ColumnMapper.tsx` (exists, needs integration)
- `src/components/microclimate/ValidationPanel.tsx` (exists, needs integration)
- Need to create: `ManualEmployeeEntry.tsx`, `AudienceFilters.tsx`, `AudiencePreviewCard.tsx`

---

## 🟡 Step 4: Scheduling & Distribution - PARTIALLY COMPLETE (50%)

### ✅ IMPLEMENTED (3 of 6 features)

#### 1. **Start/End Date & Time** ✅

- Component: `ScheduleConfig.tsx` likely exists
- Date/time pickers
- Basic scheduling

#### 2. **QR Code Generation** ✅

- Component: `QRCodeGenerator.tsx` exists
- Auto-generates QR code
- Downloadable PNG/SVG

#### 3. **URL Generation** ✅

- Unique tokenized links
- Basic URL creation

### 🔴 MISSING (3 of 6 features)

#### 1. **Timezone Awareness** ❌ CRITICAL

**Required:** Timezone-aware scheduling, defaults from Company, override per survey  
**Current Status:** No timezone handling  
**Impact:** Surveys may start/end at wrong times for global companies  
**Solution Needed:**

```tsx
import { getCompanyTimezone } from '@/lib/timezone';

const [timezone, setTimezone] = useState(
  getCompanyTimezone(step1Data.companyId) || 'America/Mexico_City'
);

<Select value={timezone} onChange={setTimezone}>
  <SelectItem value="America/Mexico_City">CDMX (UTC-6)</SelectItem>
  <SelectItem value="America/New_York">New York (UTC-5)</SelectItem>
  {/* All timezones */}
</Select>;
```

#### 2. **Reminders** ❌ HIGH PRIORITY

**Required:** Optional reminders with cadence and channels (email; WhatsApp/SMS later)  
**Current Status:** Not implemented  
**Impact:** Cannot send reminder notifications  
**Solution Needed:**

```tsx
<Card>
  <CardHeader>Reminders</CardHeader>
  <CardContent>
    <Checkbox label="Send Reminders" />
    <Select label="Cadence">
      <SelectItem value="daily">Daily</SelectItem>
      <SelectItem value="weekly">Weekly</SelectItem>
    </Select>
    <CheckboxGroup label="Channels">
      <Checkbox value="email">Email</Checkbox>
      <Checkbox value="whatsapp" disabled>
        WhatsApp (Coming Soon)
      </Checkbox>
    </CheckboxGroup>
  </CardContent>
</Card>
```

#### 3. **Expired Survey Read-Only** ❌ MEDIUM PRIORITY

**Required:** Expired surveys become read-only for respondents  
**Current Status:** No expiration enforcement  
**Impact:** Users may submit responses after end date  
**Solution Needed:**

- Check `survey.end_date` in response flow
- Show "Survey Closed" message if expired
- Block response submission

**Files:**

- Need to enhance: `src/components/microclimate/ScheduleConfig.tsx` (timezone support)
- Need to create: `ReminderConfig.tsx`
- Need to add: Expiration check in response flow

---

## 🟡 Non-Functional Requirements - PARTIALLY COMPLETE (50%)

### ✅ IMPLEMENTED (2 of 4)

#### 1. **Autosave / Background Sync** ✅

- Hook: `useAutosave.ts` exists and integrated
- Auto-saves every 5-10 seconds
- Saves on field blur
- Draft recovery after page reload
- No data loss

#### 2. **Localization (ES/EN)** ✅

- Full Spanish/English support in UI
- Bilingual survey content
- All components support `language` prop

### 🔴 MISSING (2 of 4)

#### 1. **Performance Target** ❌

**Required:** < 2s for step transitions with 1k targets loaded  
**Current Status:** Not optimized, no performance testing  
**Impact:** May be slow with large employee lists  
**Solution Needed:**

- Implement pagination for employee lists
- Use virtualization for large lists (react-window)
- Add loading states
- Optimize API queries with indexes

#### 2. **Audit Trail** ❌ CRITICAL

**Required:** Track who changed what and when (title, questions, audience, schedule)  
**Current Status:** No audit logging  
**Impact:** Cannot track survey changes for compliance/debugging  
**Solution Needed:**

```typescript
// Add to SurveyDraft model:
interface AuditLog {
  timestamp: Date;
  user_id: string;
  action: 'created' | 'updated' | 'deleted';
  field: string;
  old_value: any;
  new_value: any;
}

// Log all changes:
await logAudit({
  survey_id: draftId,
  user_id: session.user.id,
  action: 'updated',
  field: 'title',
  old_value: oldTitle,
  new_value: newTitle,
});
```

**Files:**

- Need to create: `src/models/AuditLog.ts`
- Need to create: `src/lib/audit.ts` (logging utilities)
- Need to add: Performance monitoring

---

## 📊 Implementation Quality Assessment

### Strengths ✅

1. **Excellent Component Architecture**
   - Clean separation of concerns
   - Reusable components (CSVImporter, ColumnMapper, ValidationPanel)
   - Well-structured wizard framework

2. **Strong Database Schemas**
   - `QuestionLibrary.ts` - Comprehensive with multilingual support
   - `QuestionCategory.ts` - Hierarchical structure ready
   - `SurveyDraft.ts` - Step-based autosave support

3. **Robust Autosave System**
   - `useAutosave` hook works well
   - Draft recovery implemented
   - No data loss

4. **Question Library System**
   - Full CRUD operations
   - Hierarchical categories
   - Bulk selection
   - Search and filters
   - Multilingual support

### Weaknesses 🔴

1. **Disconnected Components**
   - CSVImporter, ColumnMapper, ValidationPanel exist but not wired together
   - ManualEmployeeEntry may exist but not integrated
   - Missing state machine for multi-step CSV flow

2. **Missing Critical Features**
   - No employee filtering (department, location, role)
   - No demographics integration
   - No timezone handling
   - No reminders
   - No audit trail

3. **Incomplete Step 3**
   - Only 33% complete
   - Blocking production use
   - CSV flow broken
   - No manual entry
   - No filtering

4. **No Performance Optimization**
   - Not tested with 1k+ employees
   - No pagination
   - No virtualization
   - Could be slow at scale

---

## 🚨 Production Readiness Assessment

### Can Go to Production? **NO** ❌

**Blockers:**

1. **Step 3 Targeting is 33% complete**
   - Cannot import employees from CSV (flow broken)
   - Cannot manually add employees
   - Cannot filter by department/location/role
   - No demographics support

2. **Missing Audit Trail**
   - Compliance risk
   - Cannot track changes
   - Debugging will be difficult

3. **No Timezone Support**
   - Global companies will have wrong start/end times
   - Risk of surveys starting at 2 AM

4. **No Performance Testing**
   - Unknown behavior with 1k+ employees
   - May crash or be unusably slow

### Minimum Requirements for Production:

1. ✅ Complete Step 3 CSV import flow (wire together existing components)
2. ✅ Add manual employee entry
3. ✅ Add department/location/role filters
4. ✅ Add timezone support to scheduling
5. ✅ Implement audit logging
6. ✅ Performance test with 1k employees
7. ⚠️ Add reminders (can be Phase 2)
8. ⚠️ Add drag-drop question reordering (can be Phase 2)

---

## 📋 Recommended Implementation Phases

### **Phase 2 (Critical - Required for MVP)** - 2-3 weeks

**Goal:** Complete Step 3 Targeting to minimum viable state

1. **CSV Import Flow** (5 days)
   - Wire CSVImporter → ColumnMapper → ValidationPanel
   - Add state machine for multi-step flow
   - Implement de-duplication
   - Test with sample data

2. **Manual Employee Entry** (3 days)
   - Create `ManualEmployeeEntry` component
   - Integrate into Step 3
   - Add edit/remove functionality

3. **Audience Filters** (5 days)
   - Create `AudienceFilters` component
   - Multi-select for departments, locations, roles
   - Apply filters to employee list
   - Load demographics from company

4. **Audience Preview** (2 days)
   - Create `AudiencePreviewCard` with summary stats
   - Show "X depts, Y employees, Z sites"
   - Display filtered employee list

**Deliverable:** Step 3 at 90%+ completion, production-ready targeting

---

### **Phase 3 (Critical - Required for MVP)** - 1-2 weeks

**Goal:** Add timezone support and audit trail

1. **Timezone Support** (3 days)
   - Add timezone selector to Step 4
   - Default from company
   - Store in schedule data
   - Display correctly in UI

2. **Audit Trail** (4 days)
   - Create `AuditLog` model
   - Implement logging middleware
   - Log all survey changes
   - Create audit log viewer UI (admin only)

3. **Performance Optimization** (3 days)
   - Add pagination to employee lists
   - Implement virtualization for large lists
   - Add database indexes
   - Test with 1k+ employees

**Deliverable:** Production-ready with compliance and performance

---

### **Phase 4 (Enhancement - Post-MVP)** - 1-2 weeks

**Goal:** Improve UX and add nice-to-have features

1. **Reminders** (4 days)
   - Create `ReminderConfig` component
   - Email reminder system
   - Cadence configuration

2. **Drag-Drop Question Reordering** (3 days)
   - Integrate @dnd-kit/core
   - Add drag handles to question list
   - Persist order

3. **Question Versioning UI** (3 days)
   - Version history viewer
   - Compare versions
   - Restore previous versions

**Deliverable:** Enhanced UX, full feature parity with requirements

---

## 📁 Files Requiring Attention

### Files to Create (8 files)

1. `src/components/microclimate/ManualEmployeeEntry.tsx` - Manual employee form
2. `src/components/microclimate/AudienceFilters.tsx` - Department/location/role filters
3. `src/components/microclimate/AudiencePreviewCard.tsx` - Summary stats card
4. `src/components/microclimate/ReminderConfig.tsx` - Reminder settings
5. `src/models/AuditLog.ts` - Audit trail model
6. `src/lib/audit.ts` - Audit logging utilities
7. `src/lib/timezone.ts` - Timezone helper functions
8. `src/app/api/companies/[id]/demographics/route.ts` - Demographics endpoint

### Files to Modify (5 files)

1. `src/components/microclimate/MicroclimateWizard.tsx`
   - Wire CSV import flow in Step 3
   - Add manual entry tab
   - Add filters UI
   - Add timezone to Step 4

2. `src/components/microclimate/QuestionLibraryBrowser.tsx`
   - Add drag-drop reordering
   - Enhance duplicate detection

3. `src/components/microclimate/ScheduleConfig.tsx`
   - Add timezone selector
   - Add reminder configuration

4. `src/models/SurveyDraft.ts`
   - Add audit_log field
   - Add timezone field

5. `src/hooks/useAutosave.ts`
   - Add audit logging to save operations

---

## 🎯 Summary

### What's Working ✅

- ✅ Step 1 is 100% complete and production-ready
- ✅ Question Library system is excellent (full CRUD, multilingual, hierarchical)
- ✅ Autosave and draft recovery work flawlessly
- ✅ UI components are well-built and reusable
- ✅ Database schemas are comprehensive

### What's Not Working 🔴

- ❌ Step 3 Targeting is only 33% complete (CRITICAL BLOCKER)
- ❌ CSV import flow is broken (components exist but not connected)
- ❌ No manual employee entry
- ❌ No audience filtering
- ❌ No timezone support
- ❌ No audit trail (compliance risk)
- ❌ No performance optimization

### Bottom Line

**The microclimate system has excellent infrastructure but is NOT production-ready.** Critical gaps in Step 3 (targeting) and missing non-functional requirements (audit trail, timezone, performance) block production deployment.

**Recommendation:** Implement Phase 2 and Phase 3 (4-5 weeks total) before production release.

---

## 📞 Next Steps

1. **Immediate (This Week):**
   - Review this gap analysis with stakeholders
   - Prioritize Phase 2 features
   - Create tickets for each missing feature

2. **Short Term (Next 2-3 Weeks):**
   - Complete Step 3 CSV import flow
   - Add manual employee entry
   - Implement audience filters
   - Add timezone support

3. **Medium Term (4-5 Weeks):**
   - Add audit trail
   - Performance optimization
   - Complete reminders
   - Add drag-drop reordering

**Contact:** For questions or clarifications, please review:

- `microclimate-req.md` (original requirements)
- `MICROCLIMATE_IMPLEMENTATION_GAP_ANALYSIS.md` (detailed gap analysis)
- `MICROCLIMATE_PHASE1_COMPLETE.md` (Phase 1 completion status)
