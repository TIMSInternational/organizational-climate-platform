using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DepartmentConfiguration : IEntityTypeConfiguration<Department>
{
    public void Configure(EntityTypeBuilder<Department> builder)
    {
        builder.ToTable("departments");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.LegacyExternalId).HasColumnName("legacy_external_id").HasMaxLength(64);
        builder.Property(d => d.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(d => d.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(d => d.Description).HasColumnName("description").HasMaxLength(1000);
        builder.Property(d => d.ParentDepartmentId).HasColumnName("parent_department_id");
        builder.Property(d => d.ManagerId).HasColumnName("manager_id");
        builder.Property(d => d.EmployeeCount).HasColumnName("employee_count").IsRequired().HasDefaultValue(0);
        builder.Property(d => d.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(d => d.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(d => d.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.OwnsOne(d => d.Settings, settings =>
        {
            settings.Property(s => s.SurveyParticipationRequired).HasColumnName("settings_survey_participation_required").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.MicroclimateFrequency).HasColumnName("settings_microclimate_frequency").HasConversion<string>().HasMaxLength(20).IsRequired().HasDefaultValue("monthly");
            settings.Property(s => s.AutoActionPlans).HasColumnName("settings_auto_action_plans").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.NotificationEmail).HasColumnName("settings_notification_email").IsRequired().HasDefaultValue(true);
            settings.Property(s => s.NotificationSlack).HasColumnName("settings_notification_slack").IsRequired().HasDefaultValue(false);
            settings.Property(s => s.NotificationTeams).HasColumnName("settings_notification_teams").IsRequired().HasDefaultValue(false);
        });

        // The nodo_id climate-tracking scopes on is TrackingIdentifiers.ExternalNodoId, i.e.
        // `LegacyExternalId ?? Id.ToString()`. The Guid half is unique by construction; the
        // legacy half carried no constraint at all (#155), so the backfill (#154) could hand two
        // departments the same nodo_id and nothing here would notice. Both consumers break, and
        // neither breaks visibly at the point of the duplicate:
        //   * climate-tracking's nodos_cache.ExternalId is a plain unique index, and
        //     CacheSyncWorker Adds every /nodos row before a single SaveChanges -- so two
        //     departments sharing a legacy id abort the whole sync on 23505 and leave every
        //     cached nodo stale, not just the colliding one.
        //   * DashboardEndpoints.TableroAsync authorizes with `targetNodoId !=
        //     currentUser.NodoExternalId` and then selects `p.NodoExternalId == targetNodoId`,
        //     so whichever department won the id answers for the other's action plans.
        //
        // Global rather than (company_id, legacy_external_id): nodos_cache has no company column
        // and neither the tablero comparison nor its query carries a tenant qualifier, so a
        // per-company constraint would still let two tenants collide on the one key both
        // services actually compare on.
        //
        // Partial, matching the persona_external_id index this mirrors and Company.EmailDomain.
        // Multiple NULLs stay legal either way -- Postgres indexes NULLs as distinct unless told
        // NULLS NOT DISTINCT -- so the filter is not what buys that; what it buys is an index
        // covering only the rows that carry a legacy id, which today is none of them and after
        // the backfill is still only the migrated ones.
        builder.HasIndex(d => d.LegacyExternalId).IsUnique().HasFilter("legacy_external_id IS NOT NULL");

        builder.HasOne<Company>().WithMany().HasForeignKey(d => d.CompanyId);
        builder.HasOne<Department>().WithMany().HasForeignKey(d => d.ParentDepartmentId).OnDelete(DeleteBehavior.Restrict);

        // manager_id pointed at users with no constraint at all (#150), so a department could
        // name a manager who had been deleted -- nothing prevented it and nothing detected it.
        //
        // SetNull, chosen deliberately rather than taken from EF's default (an optional FK
        // defaults to ClientSetNull, i.e. NO ACTION at the DB, which enforces nothing once the
        // row leaves the change tracker):
        //   * Cascade is obviously wrong -- deleting a person would delete the department they
        //     ran, taking its hierarchy, its surveys' scoping and its action plans with it.
        //   * Restrict is what UserConfiguration uses for the User -> User self-reference, but
        //     that is a different shape of relationship. There, blocking the delete protects a
        //     reporting chain from being silently severed mid-tree. Here the dependent is a
        //     department, an org-structure row that is *expected* to outlive any individual
        //     manager, and Restrict would make erasing a manager fail outright -- exactly the
        //     GDPR-erasure problem #144 has to solve. The closer precedent is the mirror-image
        //     FK one file over: User.DepartmentId -> Department is SetNull, a nullable pointer
        //     between the two entities that nulls rather than blocks.
        //   * SetNull therefore keeps the invariant that matters -- manager_id is either NULL
        //     or a live user, never a dangling id -- while leaving erasure unblocked.
        //
        // ManagerId is Guid?, so the FK is optional. Confirmed rather than assumed: the
        // generated migration adds the constraint and its index only, with no AlterColumn
        // promoting manager_id to NOT NULL, and a test pins that a department with no manager
        // still saves.
        //
        // This closes a users <-> departments FK cycle (users.department_id -> departments,
        // departments.manager_id -> users). Postgres allows it, and both directions are
        // SET NULL so neither can chain into a delete. It does mean a single SaveChanges that
        // inserts a user and a department pointing at each other must be split in two, which
        // is what the seeding order in TrackingInternalEndpointsTests already does.
        builder.HasOne<User>().WithMany().HasForeignKey(d => d.ManagerId).OnDelete(DeleteBehavior.SetNull);
    }
}
