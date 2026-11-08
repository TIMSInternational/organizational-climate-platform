using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class CompanyLogoConfiguration : IEntityTypeConfiguration<CompanyLogo>
{
    public void Configure(EntityTypeBuilder<CompanyLogo> builder)
    {
        builder.ToTable("company_logos");
        builder.HasKey(l => l.CompanyId);
        builder.Property(l => l.CompanyId).HasColumnName("company_id");
        builder.Property(l => l.Content).HasColumnName("content").IsRequired();
        builder.Property(l => l.ContentType).HasColumnName("content_type").HasMaxLength(20).IsRequired();
        builder.Property(l => l.Sha256).HasColumnName("sha256").HasMaxLength(64).IsRequired();
        builder.Property(l => l.UpdatedAt).HasColumnName("updated_at").IsRequired();

        // The logo is the company's: it goes when the company goes.
        builder.HasOne<Company>().WithOne().HasForeignKey<CompanyLogo>(l => l.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}
