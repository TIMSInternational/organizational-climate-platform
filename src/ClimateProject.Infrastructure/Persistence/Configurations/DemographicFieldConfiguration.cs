using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class DemographicFieldConfiguration : IEntityTypeConfiguration<DemographicField>
{
    public void Configure(EntityTypeBuilder<DemographicField> builder)
    {
        builder.ToTable("demographic_fields");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(f => f.Field).HasColumnName("field").HasMaxLength(100).IsRequired();
        builder.Property(f => f.Label).HasColumnName("label").HasMaxLength(200).IsRequired();
        builder.Property(f => f.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(f => f.Options).HasColumnName("options").HasColumnType("text[]");
        builder.Property(f => f.Required).HasColumnName("required").IsRequired().HasDefaultValue(false);
        builder.Property(f => f.Order).HasColumnName("order").IsRequired().HasDefaultValue(0);
        builder.Property(f => f.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(f => f.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(f => f.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(f => new { f.CompanyId, f.Field }).IsUnique();
        builder.HasIndex(f => new { f.CompanyId, f.Order });

        builder.HasOne<Company>().WithMany().HasForeignKey(f => f.CompanyId);
    }
}
