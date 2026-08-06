using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class UserDemographicConfiguration : IEntityTypeConfiguration<UserDemographic>
{
    public void Configure(EntityTypeBuilder<UserDemographic> builder)
    {
        builder.ToTable("user_demographics");

        // Composite key, not a surrogate Id: a user has at most ONE answer per
        // demographic field, and the database should be the thing that says so.
        // The old jsonb blob got this for free (object keys are unique) and it
        // must not be lost on the way out of it.
        builder.HasKey(d => new { d.UserId, d.DemographicFieldId });
        builder.Property(d => d.UserId).HasColumnName("user_id");
        builder.Property(d => d.DemographicFieldId).HasColumnName("demographic_field_id");
        builder.Property(d => d.Value).HasColumnName("value").HasMaxLength(500).IsRequired();
        builder.Property(d => d.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(d => d.UpdatedAt).HasColumnName("updated_at").IsRequired();

        // The whole point of #193: "give me every user whose <field> is <value>"
        // has to be an index seek, not a jsonb scan, for dashboard filters and
        // exports (req.md 2.2).
        builder.HasIndex(d => new { d.DemographicFieldId, d.Value });

        builder.HasOne<User>().WithMany().HasForeignKey(d => d.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<DemographicField>().WithMany().HasForeignKey(d => d.DemographicFieldId).OnDelete(DeleteBehavior.Cascade);
    }
}
