using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class CompanyServiceLicenseConfiguration : IEntityTypeConfiguration<CompanyServiceLicense>
{
    public void Configure(EntityTypeBuilder<CompanyServiceLicense> builder)
    {
        builder.ToTable("company_service_licenses");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(l => l.ServiceType).HasColumnName("service_type").HasMaxLength(50).IsRequired();
        builder.Property(l => l.SeatsTotal).HasColumnName("seats_total").IsRequired();
        builder.Property(l => l.SeatsUsed).HasColumnName("seats_used").IsRequired();
        builder.Property(l => l.Status).HasColumnName("status").HasMaxLength(20).IsRequired();
        builder.Property(l => l.Notes).HasColumnName("notes").HasMaxLength(1000);
        builder.Property(l => l.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(l => l.UpdatedAt).HasColumnName("updated_at").IsRequired();

        // One licence per company+service — the target of the guarded atomic seat increment.
        builder.HasIndex(l => new { l.CompanyId, l.ServiceType }).IsUnique();

        // An entitlement ledger: a company with licences cannot be silently deleted out from under them.
        builder.HasOne<Company>().WithMany().HasForeignKey(l => l.CompanyId).OnDelete(DeleteBehavior.Restrict);
    }
}
