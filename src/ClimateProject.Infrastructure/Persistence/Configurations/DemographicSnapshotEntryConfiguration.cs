using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DemographicSnapshotEntryConfiguration : IEntityTypeConfiguration<DemographicSnapshotEntry>
{
    public void Configure(EntityTypeBuilder<DemographicSnapshotEntry> builder)
    {
        builder.ToTable("demographic_snapshot_entries");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.SnapshotId).HasColumnName("snapshot_id").IsRequired();
        builder.Property(e => e.UserId).HasColumnName("user_id").IsRequired();
        builder.Property(e => e.Department).HasColumnName("department").HasMaxLength(200).IsRequired();
        builder.Property(e => e.Role).HasColumnName("role").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Tenure).HasColumnName("tenure").HasMaxLength(100).IsRequired();
        builder.Property(e => e.Location).HasColumnName("location").HasMaxLength(200);
        builder.Property(e => e.Team).HasColumnName("team").HasMaxLength(200);
        builder.Property(e => e.Level).HasColumnName("level").HasMaxLength(100);
        builder.Property(e => e.CustomAttributes).HasColumnName("custom_attributes").HasColumnType("jsonb");

        builder.HasIndex(e => e.SnapshotId);
        builder.HasIndex(e => e.UserId);
        builder.HasIndex(e => e.Department);
        builder.HasIndex(e => e.Role);

        builder.HasOne<DemographicSnapshot>().WithMany().HasForeignKey(e => e.SnapshotId);
        builder.HasOne<User>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
