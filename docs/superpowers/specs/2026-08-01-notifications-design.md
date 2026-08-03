# Notifications Domain (#55) — Design

## Architecture

Standard domain pattern, matching every prior migrated domain: minimal-API endpoints +
manual role checks, typed frontend API clients, new pages. Two endpoint groups:

1. **Templates** (admin-managed): CRUD on `NotificationTemplate` + its child
   `NotificationTemplateVariable`/`NotificationPersonalizationRule` rows. No hard delete —
   `IsActive` toggle only (matches the entity's existing field and the codebase-wide
   no-hard-delete convention). Children are fully replaced on update (delete-then-recreate
   the variable/rule lists), matching `DemographicFieldEndpoints.UpdateAsync`'s established
   pattern — no separate restrict/cascade FK policy needed since there's no hard delete at
   the template level to cascade from.
2. **Notifications** (dispatch + self-service): `CompanyAdmin`/`SuperAdmin` can create/list
   company-wide; every authenticated user can list and mark-read their *own* notifications
   (`UserId` match, resolved from the JWT `sub` claim the same way `AuthEndpoints.cs`'s
   `/auth/me`-equivalent already does — `PersonaExternalId` first, fall back to parsing
   `sub` as the user's own `Id`). "Mark read" sets `OpenedAt` — no separate `IsRead` field
   needed, the entity already has this timestamp.

## Delivery: stub sender, no background worker

Mirrors the established `IInvitationEmailSender`/`LoggingInvitationEmailSender` pattern
exactly: `INotificationSender.SendAsync(Notification, CancellationToken)`, a
`LoggingNotificationSender` implementation that logs and returns
`Task.CompletedTask`, called synchronously at creation time (sets `SentAt`/`Status="sent"`
immediately). `ClimateProject.Workers` stays an empty skeleton — no new background job in
this pass. Swappable for a real channel (email/SMS/push) + a real delivery queue later,
same as invitation email.

## Out of scope

- Real delivery (email/SMS/push) — stubbed, matching every other outbound-comms decision
  in this migration.
- A background delivery/retry worker — `RetryCount`/`MaxRetries`/`FailedAt` fields exist on
  the entity for future use but aren't exercised by this pass (creation always succeeds via
  the stub sender).
- Personalization-rule evaluation logic (the `Condition`/`Modifications` fields are stored
  as opaque strings, not interpreted) — this domain ships the data model + CRUD, not a rule
  engine.

  **When it is implemented (#96), the approach is already fixed by #73:** see
  [2026-08-03-notification-condition-evaluator-design.md](./2026-08-03-notification-condition-evaluator-design.md).
  A typed, non-executing condition — parsed from the legacy string form with a strict
  whitelist, rejected at write time *and* re-validated at evaluation time. The legacy
  implementation used `new Function()` on admin-editable strings, which is tenant-controlled
  arbitrary code execution; it must not be ported. Only one condition exists in the legacy
  data (`reminderCount >= 3`), so the safe design costs almost nothing.
