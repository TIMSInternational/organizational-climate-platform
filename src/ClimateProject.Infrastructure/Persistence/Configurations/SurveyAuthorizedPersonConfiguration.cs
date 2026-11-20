using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// <c>survey_authorized_people</c>: a survey's «Lista autorizada del cliente»
/// (<see cref="SurveyAuthorizedPerson"/>). One row per address per survey; the rows go with the
/// survey, and who added one is SET NULL when that person is deleted.
/// </summary>
public class SurveyAuthorizedPersonConfiguration : IEntityTypeConfiguration<SurveyAuthorizedPerson>
{
    /// <summary>RFC 5321's longest address.</summary>
    public const int EmailMaxLength = 320;

    public const int DisplayNameMaxLength = 200;

    public void Configure(EntityTypeBuilder<SurveyAuthorizedPerson> builder)
    {
        builder.ToTable("survey_authorized_people");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(p => p.SurveyId).HasColumnName("survey_id").IsRequired();
        builder.Property(p => p.Email).HasColumnName("email").HasMaxLength(EmailMaxLength).IsRequired();
        builder.Property(p => p.DisplayName).HasColumnName("display_name").HasMaxLength(DisplayNameMaxLength);
        builder.Property(p => p.AddedBy).HasColumnName("added_by");
        builder.Property(p => p.AddedAt).HasColumnName("added_at").IsRequired();

        builder.HasIndex(p => new { p.SurveyId, p.Email }).IsUnique();

        builder.HasOne<Survey>().WithMany().HasForeignKey(p => p.SurveyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(p => p.AddedBy).OnDelete(DeleteBehavior.SetNull);
    }
}
