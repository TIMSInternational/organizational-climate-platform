using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class MicroclimateDepartmentTargetConfiguration : IEntityTypeConfiguration<MicroclimateDepartmentTarget>
{
    public void Configure(EntityTypeBuilder<MicroclimateDepartmentTarget> builder)
    {
        builder.ToTable("microclimate_department_targets");
        builder.HasKey(t => new { t.MicroclimateId, t.DepartmentId });
        builder.Property(t => t.MicroclimateId).HasColumnName("microclimate_id").IsRequired();
        builder.Property(t => t.DepartmentId).HasColumnName("department_id").IsRequired();

        builder.HasOne<Microclimate>().WithMany().HasForeignKey(t => t.MicroclimateId);
        builder.HasOne<Department>().WithMany().HasForeignKey(t => t.DepartmentId).OnDelete(DeleteBehavior.Restrict);
    }
}
