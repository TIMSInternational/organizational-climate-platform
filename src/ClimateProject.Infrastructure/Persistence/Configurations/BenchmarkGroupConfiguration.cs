using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class BenchmarkGroupConfiguration : IEntityTypeConfiguration<BenchmarkGroup>
{
    public void Configure(EntityTypeBuilder<BenchmarkGroup> builder)
    {
        builder.ToTable("benchmark_groups");
        builder.HasKey(g => g.Id);
        builder.Property(g => g.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        // The same widths as the Company columns they are matched against.
        builder.Property(g => g.Industry).HasColumnName("industry").HasMaxLength(100);
        builder.Property(g => g.CompanySize).HasColumnName("company_size").HasMaxLength(50);
        builder.Property(g => g.Country).HasColumnName("country").HasMaxLength(100);
        builder.Property(g => g.ServiceType).HasColumnName("service_type").HasMaxLength(50).IsRequired();
        builder.Property(g => g.CreatedBy).HasColumnName("created_by").IsRequired();
        builder.Property(g => g.CreatedAt).HasColumnName("created_at").IsRequired();

        // Two groups with one name would be two rows in a picker nobody can tell apart.
        builder.HasIndex(g => g.Name).IsUnique().HasDatabaseName("ux_benchmark_groups_name");

        // The instrument family is a closed vocabulary; the database refuses anything else
        // rather than trusting the one handler that writes it.
        builder.ToTable(t => t.HasCheckConstraint(
            "ck_benchmark_groups_service_type",
            "service_type IN ('general_climate', 'organizational_culture', 'microclimate')"));
    }
}
