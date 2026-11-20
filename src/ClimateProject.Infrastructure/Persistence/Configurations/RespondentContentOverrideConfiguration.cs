using ClimateProject.Application.RespondentContent;
using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// <c>respondent_content_overrides</c>: a company's or a survey's own wording for a registry key
/// (<see cref="RespondentContentOverride"/>).
/// </summary>
/// <remarks>
/// <para><b>Two partial unique indexes, not one.</b> Uniqueness is per (company, survey, key,
/// locale), and in Postgres two NULLs never collide in a unique index -- so a single index over
/// all four would let a company hold two rows for one key. A company row is unique on
/// (company, key, locale) WHERE survey_id IS NULL; a survey row on (company, survey, key,
/// locale) WHERE survey_id IS NOT NULL.</para>
/// <para><b>Deleted with what owns it.</b> Both foreign keys cascade: a survey's rows go with the
/// survey, a company's with the company. Who wrote a row is SET NULL, so deleting a person never
/// blocks or takes a text with them.</para>
/// </remarks>
public class RespondentContentOverrideConfiguration : IEntityTypeConfiguration<RespondentContentOverride>
{
    public void Configure(EntityTypeBuilder<RespondentContentOverride> builder)
    {
        builder.ToTable("respondent_content_overrides");
        builder.HasKey(o => o.Id);
        builder.Property(o => o.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(o => o.CompanyId).HasColumnName("company_id").IsRequired();
        builder.Property(o => o.SurveyId).HasColumnName("survey_id");
        builder.Property(o => o.Key).HasColumnName("key").HasMaxLength(100).IsRequired();
        builder.Property(o => o.Locale).HasColumnName("locale").HasMaxLength(5).IsRequired();
        builder.Property(o => o.Value).HasColumnName("value").HasMaxLength(RespondentContentRegistry.StorageMaxLength).IsRequired();
        builder.Property(o => o.UpdatedBy).HasColumnName("updated_by");
        builder.Property(o => o.UpdatedAt).HasColumnName("updated_at").IsRequired();

        builder.HasIndex(o => new { o.CompanyId, o.Key, o.Locale })
            .IsUnique()
            .HasFilter("survey_id IS NULL")
            .HasDatabaseName("ux_respondent_content_overrides_company_key_locale");
        builder.HasIndex(o => new { o.CompanyId, o.SurveyId, o.Key, o.Locale })
            .IsUnique()
            .HasFilter("survey_id IS NOT NULL")
            .HasDatabaseName("ux_respondent_content_overrides_survey_key_locale");

        builder.HasOne<Company>().WithMany().HasForeignKey(o => o.CompanyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Survey>().WithMany().HasForeignKey(o => o.SurveyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<User>().WithMany().HasForeignKey(o => o.UpdatedBy).OnDelete(DeleteBehavior.SetNull);
    }
}
