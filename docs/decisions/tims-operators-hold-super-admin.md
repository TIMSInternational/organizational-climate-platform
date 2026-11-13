# Decision: a TIMS operator holds `super_admin`, and the scoped operator role is deferred

Recorded 2026-10-28 against `3ef40c3a`. Owner: Federico Tafur (decided 28 Oct 2026).

TIMS is giving its own staff access to the platform so that they can run a client engagement
end to end — create the company, settle its settings, build the climate, import the roster,
distribute the codes, and read the results — without a shell, a database console, or a
developer. This file records who they have to **be** in order to do that.

## The measurement that forces the decision

There are five roles (`Roles.cs`: `super_admin`, `company_admin`, `leader`, `supervisor`,
`employee`) and **nothing between "one tenant" and "every tenant"**. These refuse anyone who
is not `super_admin`:

| Operation | Gate |
|---|---|
| List companies · create a company · read one · update one | `CompanyEndpoints.cs:31, 51, 115, 139` |
| Grant or adjust a service licence / seats | `CompanyLicenseEndpoints.cs:33, 67, 109` |
| The question library and the question bank | `QuestionLibraryEndpoints.cs:77, 231`, `QuestionBankEndpoints.cs:144, 163` |
| Export responses | `ResponseExportEndpoints.cs:87` |
| System settings · audit logs · notification templates | `SystemSettingsEndpoints.cs:90`, `AuditEndpoints.cs:93`, `NotificationTemplateEndpoints.cs:74` |
| Cross-company benchmarks | `BenchmarkEndpoints.cs:123, 477`, `BenchmarkAnalyticsEndpoints.cs:390, 522` |

A `company_admin` can run a tenant it already belongs to — settings
(`CompanyEndpoints.cs:341` admits the company's own admin), surveys, the roster, distribution,
the per-person credential reissue — but cannot create the company in the first place. So there
is no configuration of existing roles under which a TIMS operator starts a new engagement.

## The decision

**A TIMS operator is a `super_admin`.** One account per person, never shared.

**What that grants, stated plainly rather than discovered later.** A `super_admin` can read
every tenant's results, every export, the audit log and the cross-company benchmarks. It is
not scoped to the engagements that operator works on. Creating the account is the whole
implementation; there is nothing to build.

## Why that is acceptable here, and where the line still is

This product's privacy posture is deliberate and already documented: a floor of **3**
respondents applied at read time, no verbatim open-text content ever returned, and every
survey anonymous **to the client**. "Anonymous to the client" has always meant TIMS can see
more than the client can — TIMS is the processor, and the respondent-facing text says so
(#581, "the respondent is told who reads their answers"). An operator who can read the
results of the engagement they are running is inside that promise, not outside it.

The three limits that do **not** move, and that `super_admin` does not lift:

- the privacy floor of 3 is applied at read time to every surface, including a
  `super_admin`'s;
- verbatim open-text responses are never returned to anybody, at any role — word frequencies
  only;
- a worker's survey credentials are never sent to the client, and the client never receives
  the audit workbook.

So the grant widens *which tenants* an operator can read, not *what* may be read about a
respondent.

## Rejected for now: a scoped operator role

A sixth role that can create and configure a company but not read its results. It is the
better long-run answer and it was **deferred, not refused**: it changes authorization across
the eight endpoint groups in the table above plus the web role checks, needs its own test
pass, and needs its own ruling on what "configure but not read" includes (does it include the
roster? the distribution screen that lists every person's email? the audit log?). Those
questions are not answerable from the gap audit that surfaced them.

Deferring it has a cost and it should be named: until it exists, TIMS cannot give the platform
to somebody who should only touch one client. Every operator is trusted with all of them.

## How to revisit

The brief is `docs/audits/2026-10-28-operations-gap.md` § "The access question". Revisit when
either (a) somebody needs access to one engagement and not the others — a contractor, a
client-side co-administrator, an intern — or (b) a client's procurement asks who at TIMS can
read their data and the answer "every operator" is not good enough.
