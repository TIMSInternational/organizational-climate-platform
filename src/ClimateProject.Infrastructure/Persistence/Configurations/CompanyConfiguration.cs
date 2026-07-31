using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class CompanyConfiguration : IEntityTypeConfiguration<Company>
{
    public void Configure(EntityTypeBuilder<Company> builder)
    {
        builder.ToTable("companies");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
        builder.Property(c => c.EmailDomain).HasColumnName("email_domain").HasMaxLength(255);
        builder.Property(c => c.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.HasIndex(c => c.EmailDomain).IsUnique().HasFilter("email_domain IS NOT NULL");
    }
}
