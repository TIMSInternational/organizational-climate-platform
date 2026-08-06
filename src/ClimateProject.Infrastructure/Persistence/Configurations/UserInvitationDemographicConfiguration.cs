using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class UserInvitationDemographicConfiguration : IEntityTypeConfiguration<UserInvitationDemographic>
{
    public void Configure(EntityTypeBuilder<UserInvitationDemographic> builder)
    {
        builder.ToTable("user_invitation_demographics");

        builder.HasKey(d => new { d.InvitationId, d.DemographicFieldId });
        builder.Property(d => d.InvitationId).HasColumnName("invitation_id");
        builder.Property(d => d.DemographicFieldId).HasColumnName("demographic_field_id");
        builder.Property(d => d.Value).HasColumnName("value").HasMaxLength(500).IsRequired();

        builder.HasIndex(d => new { d.DemographicFieldId, d.Value });

        builder.HasOne<UserInvitation>().WithMany().HasForeignKey(d => d.InvitationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<DemographicField>().WithMany().HasForeignKey(d => d.DemographicFieldId).OnDelete(DeleteBehavior.Cascade);
    }
}
