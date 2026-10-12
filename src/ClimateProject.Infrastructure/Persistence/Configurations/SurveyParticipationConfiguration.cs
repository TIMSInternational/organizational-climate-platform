using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// <c>survey_participations</c>: who answered, never what. There is deliberately no foreign key
/// to <c>responses</c> and no column that could hold one -- see <see cref="SurveyParticipation"/>.
/// </summary>
public class SurveyParticipationConfiguration : IEntityTypeConfiguration<SurveyParticipation>
{
    public void Configure(EntityTypeBuilder<SurveyParticipation> builder)
    {
        builder.ToTable("survey_participations");
        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(p => p.SurveyId).HasColumnName("survey_id");
        builder.Property(p => p.CompanyId).HasColumnName("company_id");
        builder.Property(p => p.Name).HasColumnName("name").HasMaxLength(ParticipantIdentityLimits.NameMaxLength).IsRequired();
        builder.Property(p => p.Email).HasColumnName("email").HasMaxLength(ParticipantIdentityLimits.EmailMaxLength);
        builder.Property(p => p.ParticipatedOn).HasColumnName("participated_on").HasColumnType("date");

        // A repeat by the same email is idempotent: the response still lands, the
        // participation row is not duplicated. Partial, because a name-only respondent has
        // nothing to be unique on.
        builder.HasIndex(p => new { p.SurveyId, p.Email })
            .IsUnique()
            .HasFilter("email IS NOT NULL");

        // Erasing a survey or a company erases who answered it.
        builder.HasOne<Survey>().WithMany().HasForeignKey(p => p.SurveyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Company>().WithMany().HasForeignKey(p => p.CompanyId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>Column limits, shared by the table and the submit-time validation.</summary>
public static class ParticipantIdentityLimits
{
    public const int NameMaxLength = Application.Surveys.ParticipantIdentity.NameMaxLength;
    public const int EmailMaxLength = Application.Surveys.ParticipantIdentity.EmailMaxLength;
}
