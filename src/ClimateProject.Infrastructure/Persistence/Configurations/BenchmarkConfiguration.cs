using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class BenchmarkConfiguration : IEntityTypeConfiguration<Benchmark>
{
    public void Configure(EntityTypeBuilder<Benchmark> builder)
    {
        builder.ToTable("benchmarks");
        builder.HasKey(b => b.Id);
        builder.Property(b => b.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(b => b.Description).HasColumnName("description").HasMaxLength(2000).IsRequired();
        builder.Property(b => b.Type).HasColumnName("type").HasMaxLength(20).IsRequired();
        builder.Property(b => b.Category).HasColumnName("category").HasMaxLength(100).IsRequired();
        builder.Property(b => b.Source).HasColumnName("source").HasMaxLength(200).IsRequired();
        builder.Property(b => b.Industry).HasColumnName("industry").HasMaxLength(100);
        builder.Property(b => b.CompanySize).HasColumnName("company_size").HasMaxLength(50);
        builder.Property(b => b.Region).HasColumnName("region").HasMaxLength(100);
        builder.Property(b => b.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(b => b.CompanyId).HasColumnName("company_id");
        builder.Property(b => b.IsActive).HasColumnName("is_active").IsRequired().HasDefaultValue(true);
        builder.Property(b => b.ValidationStatus).HasColumnName("validation_status").HasMaxLength(20).IsRequired().HasDefaultValue("pending");
        builder.Property(b => b.QualityScore).HasColumnName("quality_score").IsRequired().HasDefaultValue(0d);
        builder.Property(b => b.Metadata).HasColumnName("metadata").HasColumnType("jsonb");
        builder.Property(b => b.PriorPeriodBenchmarkId).HasColumnName("prior_period_benchmark_id");
        builder.Property(b => b.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(b => b.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(b => new { b.Type, b.Category });
        builder.HasIndex(b => new { b.CompanyId, b.IsActive });
        builder.HasIndex(b => new { b.Industry, b.CompanySize });
        builder.HasIndex(b => b.ValidationStatus);

        builder.HasOne<User>().WithMany().HasForeignKey(b => b.CreatedBy).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Company>().WithMany().HasForeignKey(b => b.CompanyId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Benchmark>().WithMany().HasForeignKey(b => b.PriorPeriodBenchmarkId).OnDelete(DeleteBehavior.Restrict);
    }
}
