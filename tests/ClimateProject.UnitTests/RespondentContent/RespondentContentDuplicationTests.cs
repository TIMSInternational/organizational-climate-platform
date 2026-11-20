using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;

namespace ClimateProject.UnitTests.RespondentContent;

/// <summary>
/// «Duplicar» carries the survey's own wording in <c>respondent_content_overrides</c> on both paths,
/// as <c>CopySettings</c> carries the legacy texts: words, not people.
/// </summary>
public class RespondentContentDuplicationTests
{
    private static readonly Guid CompanyId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid SourceId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid CopyId = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid Author = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Duplicator = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateTimeOffset Now = new(2026, 11, 19, 12, 0, 0, TimeSpan.Zero);

    private static SurveyStructure Source() => new(
        new Survey
        {
            Id = SourceId,
            CompanyId = CompanyId,
            CreatedBy = Author,
            TitleEs = "Clima",
            Language = "es",
            Type = "periodic",
            StartDate = Now,
            EndDate = Now.AddDays(14),
            Settings = new SurveySettings { RespondentIntroEs = "Párrafo de la encuesta" },
        },
        [],
        [],
        [],
        [],
        [])
    {
        ContentOverrides =
        [
            new RespondentContentOverride { Id = Guid.NewGuid(), CompanyId = CompanyId, SurveyId = SourceId, Key = "demographics.intro", Locale = "es", Value = "Sobre usted, a la medida", UpdatedBy = Author, UpdatedAt = Now.AddDays(-3) },
            new RespondentContentOverride { Id = Guid.NewGuid(), CompanyId = CompanyId, SurveyId = SourceId, Key = "display.textAlign", Locale = "*", Value = "start", UpdatedBy = Author, UpdatedAt = Now.AddDays(-3) },
            // A company row that reached the input by mistake is not the survey's to copy.
            new RespondentContentOverride { Id = Guid.NewGuid(), CompanyId = CompanyId, SurveyId = null, Key = "eyebrow", Locale = "es", Value = "De la empresa", UpdatedAt = Now },
        ],
    };

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void The_copy_carries_the_surveys_own_rows_on_both_paths(bool includeAudience)
    {
        var source = Source();
        var copy = SurveyDuplication.Duplicate(
            source, CopyId, Duplicator, Now, Guid.NewGuid, new SurveyDuplicateOptions(IncludeAudience: includeAudience));

        Assert.Equal(2, copy.ContentOverrides.Count);
        Assert.All(copy.ContentOverrides, row =>
        {
            Assert.Equal(CopyId, row.SurveyId);
            Assert.Equal(CompanyId, row.CompanyId);
            Assert.Equal(Duplicator, row.UpdatedBy);
            Assert.Equal(Now, row.UpdatedAt);
        });
        Assert.Contains(copy.ContentOverrides, r => r is { Key: "demographics.intro", Locale: "es", Value: "Sobre usted, a la medida" });
        Assert.Contains(copy.ContentOverrides, r => r is { Key: "display.textAlign", Locale: "*", Value: "start" });

        // New rows, never the source's.
        var sourceIds = source.ContentOverrides.Select(r => r.Id).ToHashSet();
        Assert.DoesNotContain(copy.ContentOverrides, r => sourceIds.Contains(r.Id));

        // The legacy column travels as it always has.
        Assert.Equal("Párrafo de la encuesta", copy.Survey.Settings.RespondentIntroEs);
    }
}
