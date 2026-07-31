using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DemographicSnapshotChangeConfiguration : IEntityTypeConfiguration<DemographicSnapshotChange>
{
    public void Configure(EntityTypeBuilder<DemographicSnapshotChange> builder)
    {
        builder.ToTable("demographic_snapshot_changes");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.SnapshotId).HasColumnName("snapshot_id").IsRequired();
        builder.Property(c => c.Field).HasColumnName("field").HasMaxLength(200).IsRequired();
        builder.Property(c => c.OldValue).HasColumnName("old_value").HasColumnType("jsonb");
        builder.Property(c => c.NewValue).HasColumnName("new_value").HasColumnType("jsonb");
        builder.Property(c => c.ChangedBy).HasColumnName("changed_by").IsRequired();
        builder.Property(c => c.Timestamp).HasColumnName("timestamp").IsRequired();
        builder.Property(c => c.Reason).HasColumnName("reason").HasMaxLength(500);

        builder.HasIndex(c => c.SnapshotId);

        builder.HasOne<DemographicSnapshot>().WithMany().HasForeignKey(c => c.SnapshotId);
        builder.HasOne<User>().WithMany().HasForeignKey(c => c.ChangedBy).OnDelete(DeleteBehavior.Restrict);
    }
}
