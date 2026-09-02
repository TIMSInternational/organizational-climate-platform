using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DemographicSnapshotConfiguration : IEntityTypeConfiguration<DemographicSnapshot>
{
    public void Configure(EntityTypeBuilder<DemographicSnapshot> builder)
    {
        builder.ToTable("demographic_snapshots");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(s => s.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(s => s.Version).HasColumnName("version").IsRequired();
        builder.Property(s => s.Timestamp).HasColumnName("timestamp").IsRequired();
        builder.Property(s => s.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(s => s.Reason).HasColumnName("reason").HasMaxLength(500).IsRequired();
        builder.Property(s => s.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(s => s.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.OwnsOne(s => s.Metadata, metadata =>
        {
            metadata.Property(m => m.TotalUsers).HasColumnName("metadata_total_users").IsRequired().HasDefaultValue(0);
            metadata.Property(m => m.DepartmentsCount).HasColumnName("metadata_departments_count").IsRequired().HasDefaultValue(0);
            metadata.Property(m => m.RolesDistribution).HasColumnName("metadata_roles_distribution").HasColumnType("jsonb");
            metadata.Property(m => m.TenureDistribution).HasColumnName("metadata_tenure_distribution").HasColumnType("jsonb");
        });

        builder.HasIndex(s => new { s.SurveyId, s.Version }).IsUnique();
        builder.HasIndex(s => new { s.CompanyId, s.Timestamp });
        builder.HasIndex(s => new { s.SurveyId, s.IsActive });
        builder.HasIndex(s => s.CreatedBy);

        builder.HasOne<Company>().WithMany().HasForeignKey(s => s.CompanyId);
        builder.HasOne<User>().WithMany().HasForeignKey(s => s.CreatedBy).OnDelete(DeleteBehavior.Restrict);

        // Cascade, and it is the only behaviour the column shape allows. survey_id is NOT NULL
        // (line above), so SetNull is not available; Restrict would turn today's working
        // DELETE /surveys/{id} into a 500 the moment a survey has a snapshot. A snapshot is
        // defined by its survey -- keyed (survey_id, version), listed and diffed by survey_id
        // (DemographicSnapshotEndpoints.cs:73, 133, 385) -- so one whose survey is gone has no
        // version sequence and no way back through the API.
        //
        // What this costs, stated plainly rather than discovered later: snapshot_id on
        // demographic_snapshot_entries and _changes is a required FK with EF's default Cascade
        // (DemographicSnapshotEntryConfiguration.cs:28, DemographicSnapshotChangeConfiguration.cs:23),
        // so this cascade reaches per-user demographic rows that SubjectErasure.cs:238 classifies
        // as RETAINED under erasure. Deleting a response-less survey therefore now also deletes
        // those. Reversing this to Restrict is a one-line follow-up migration if that trade is
        // judged wrong -- docs/decisions/survey-foreign-keys.md records the trade.
        builder.HasOne<Survey>().WithMany().HasForeignKey(s => s.SurveyId).OnDelete(DeleteBehavior.Cascade);
    }
}
