using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Reports;
using ClimateProject.Application.Reports.Rendering;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.UnitTests.Exports;

namespace ClimateProject.UnitTests.Reports;

/// <summary>
/// «Notas de TIMS» (ruled 2026-11-19): TIMS's introduction, conclusions and recommendations on a
/// report -- bounded, one language per reading, and printed by the report's PDF as pages of their
/// own: the introduction after the cover, conclusions and recommendations at the end, only when set.
/// </summary>
public class ReportNotesTests
{
    private const string Title = "Informe de clima 2026";
    private static readonly DateTimeOffset GeneratedAt = new(2026, 11, 19, 12, 0, 0, TimeSpan.Zero);

    private const string SpanishIntro =
        "Este informe presenta los resultados de la medición de clima organizacional de 2026, "
        + "con énfasis en la dirección, el reconocimiento y la comunicación entre áreas.\n\n"
        + "La participación alcanzó el nivel esperado; agradecemos a cada compañero y compañera "
        + "que dedicó su tiempo. ¿Qué sigue? Una conversación con cada jefatura.";

    private const string SpanishConclusions = "Conclusión única: el año cierra con señales de mejora sostenida.";
    private const string SpanishRecommendations = "Recomendamos revisar la carga de trabajo del área de atención al público.";

    // ------------------------------------------------------------------
    // The model
    // ------------------------------------------------------------------

    [Fact]
    public void Paragraphs_split_on_blank_lines_and_fold_single_line_breaks()
    {
        var paragraphs = ReportNotes.Paragraphs("Primera línea\r\nsigue igual\n\n\n  Segundo párrafo  \n \nTercero");

        Assert.Equal(["Primera línea sigue igual", "Segundo párrafo", "Tercero"], paragraphs);
        Assert.Empty(ReportNotes.Paragraphs("  \n\n  "));
        Assert.Empty(ReportNotes.Paragraphs(null));
    }

    [Fact]
    public void A_note_of_exactly_the_maximum_fits_and_one_character_more_is_named()
    {
        var atMax = new string('a', ReportNotes.MaxLength);

        Assert.Null(ReportNotes.FirstTooLong(new ReportNotesDto(IntroEs: atMax, RecommendationsEn: atMax)));
        // Surrounding whitespace is not stored, so it is not what a refusal is about.
        Assert.Null(ReportNotes.FirstTooLong(new ReportNotesDto(ConclusionsEs: $"  {atMax}\n\n")));
        Assert.Equal(
            "conclusionsEn",
            ReportNotes.FirstTooLong(new ReportNotesDto(IntroEs: atMax, ConclusionsEn: atMax + "a")));
        Assert.Null(ReportNotes.FirstTooLong(null));
    }

    [Fact]
    public void Apply_replaces_all_six_trims_them_and_stores_blank_as_null()
    {
        var report = new Report
        {
            Type = "summary",
            Format = "pdf",
            NotesIntroEn = "old",
            NotesConclusionsEs = "vieja",
        };

        ReportNotes.Apply(report, new ReportNotesDto(IntroEs: "  Hola  ", ConclusionsEs: "   "));

        Assert.Equal(new ReportNotesDto(IntroEs: "Hola"), ReportNotes.From(report));
    }

    [Fact]
    public void A_reading_gets_its_own_language_and_never_the_others()
    {
        var report = new Report { Type = "summary", Format = "pdf", NotesIntroEs = "Solo en español" };

        Assert.Equal(
            new ReportNotesText(ContentLanguages.Spanish, "Solo en español", null, null),
            ReportNotes.For(report, ContentLanguages.Spanish));
        // An English document has no Spanish page: no note in its language means none at all.
        Assert.Null(ReportNotes.For(report, ContentLanguages.English));
    }

    // ------------------------------------------------------------------
    // The PDF
    // ------------------------------------------------------------------

    [Fact]
    public void The_introduction_is_its_own_page_right_after_the_cover_in_the_reports_language()
    {
        var pages = PdfText.Pages(ReportRenderer.BuildPdf(SpanishContext(new ReportNotesText(
            ContentLanguages.Spanish, SpanishIntro, null, null))));

        // Page 1 is the cover: the title, and no note.
        Assert.Contains(Title, pages[0]);
        Assert.DoesNotContain("Introducción", pages[0]);

        // Page 2 is the introduction and nothing else of the report's: heading first, both
        // paragraphs, accents and the inverted question mark intact.
        var intro = pages[1];
        Assert.Equal("Introducción", intro[0]);
        var prose = string.Join(" ", intro);
        Assert.Contains(
            "Este informe presenta los resultados de la medición de clima organizacional de 2026, con énfasis en la dirección, el reconocimiento y la comunicación entre áreas.",
            prose,
            StringComparison.Ordinal);
        Assert.Contains("¿Qué sigue? Una conversación con cada jefatura.", prose, StringComparison.Ordinal);
        Assert.DoesNotContain("Alcance de este documento", intro);

        // The body starts on the page after it.
        Assert.Contains("Alcance de este documento", pages[2]);
    }

    [Fact]
    public void Two_paragraphs_are_two_blocks_not_one_run_on_line()
    {
        var intro = PdfText.Pages(ReportRenderer.BuildPdf(SpanishContext(new ReportNotesText(
            ContentLanguages.Spanish, "Primer párrafo.\n\nSegundo párrafo.", null, null))))[1];

        Assert.Contains("Primer párrafo.", intro);
        Assert.Contains("Segundo párrafo.", intro);
        Assert.DoesNotContain("Primer párrafo. Segundo párrafo.", intro);
    }

    [Fact]
    public void Conclusions_then_recommendations_close_the_document_each_on_a_page_of_its_own()
    {
        var pages = PdfText.Pages(ReportRenderer.BuildPdf(SpanishContext(new ReportNotesText(
            ContentLanguages.Spanish, null, SpanishConclusions, SpanishRecommendations))));

        var last = pages[^1];
        var beforeLast = pages[^2];
        Assert.Equal("Conclusiones", beforeLast[0]);
        Assert.Contains(SpanishConclusions, string.Join(" ", beforeLast), StringComparison.Ordinal);
        Assert.DoesNotContain("Recomendaciones", beforeLast);

        Assert.Equal("Recomendaciones", last[0]);
        Assert.Contains(SpanishRecommendations, string.Join(" ", last), StringComparison.Ordinal);

        // No introduction was set, so the cover runs straight into the body as it always did.
        Assert.Contains("Alcance de este documento", pages[0]);
    }

    [Fact]
    public void A_long_note_wraps_within_the_margins_and_continues_onto_another_page()
    {
        // 4000 characters of words, the column's whole width.
        var words = string.Join(' ', Enumerable.Repeat("recomendación", 300));
        var note = words[..ReportNotes.MaxLength].TrimEnd();
        var document = ReportRenderer.BuildPdf(SpanishContext(new ReportNotesText(ContentLanguages.Spanish, null, null, note)));

        var drawn = PdfText.DrawnStrings(document);
        Assert.All(
            drawn.Where(line => line.StartsWith("recomendación", StringComparison.Ordinal)),
            line => Assert.True(
                PdfStandardFontMetrics.MeasureText(line, PdfStandardFont.Regular, 9.5) <= PdfDocument.ContentWidth + 0.01,
                $"overruns the margin: {line.Length} characters"));
        Assert.Equal(note, string.Join(" ", drawn.SkipWhile(s => s != "Recomendaciones").Skip(1).Where(s => s.StartsWith("recomendaci", StringComparison.Ordinal))));
    }

    [Fact]
    public void Without_notes_the_document_has_no_note_page_and_the_same_pages_as_before()
    {
        var without = ReportRenderer.BuildPdf(SpanishContext(null));
        var empty = ReportRenderer.BuildPdf(SpanishContext(new ReportNotesText(ContentLanguages.Spanish, "  ", "\n\n", null)));

        foreach (var document in new[] { without, empty })
        {
            var drawn = PdfText.DrawnStrings(document);
            Assert.DoesNotContain("Introducción", drawn);
            Assert.DoesNotContain("Conclusiones", drawn);
            Assert.DoesNotContain("Recomendaciones", drawn);
        }

        Assert.Equal(without.PageCount, empty.PageCount);
        Assert.Equal(PdfText.DrawnStrings(without), PdfText.DrawnStrings(empty));
    }

    [Fact]
    public void An_unreadable_stored_document_still_prints_the_notes()
    {
        var context = new ReportRenderContext(
            Guid.NewGuid(), "Legacy", null, "summary", GeneratedAt, Document: null,
            Notes: new ReportNotesText(ContentLanguages.English, "Our introduction.", "Our conclusions.", null));

        var pages = PdfText.Pages(ReportRenderer.BuildPdf(context));

        // Cover, introduction, the body's note that the document cannot be read, conclusions.
        Assert.Equal(4, pages.Count);
        Assert.Equal("Introduction", pages[1][0]);
        Assert.Contains("Scope of this document", pages[2]);
        Assert.Equal("Conclusions", pages[3][0]);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /// <summary>
    /// A Spanish report: one Spanish survey section, below the floor so it carries no tables --
    /// what is under test is where the notes land, not the numbers.
    /// </summary>
    private static ReportRenderContext SpanishContext(ReportNotesText? notes)
        => new(
            Guid.Parse("7e5000aa-0000-0000-0000-0000000000a7"),
            Title,
            null,
            "summary",
            GeneratedAt,
            new ReportOutputDocument(
                "Nota de generación.",
                [
                    new ReportSurveySection(
                        Guid.Parse("5e2b1d1a-0000-0000-0000-0000000000a7"),
                        "Clima 2026",
                        SurveyStatuses.Closed,
                        ContentLanguages.Spanish,
                        new SurveyResultsSummary(10, 2, 2, 0, 0.2, 1, null, null, null, []),
                        [],
                        [],
                        [],
                        null,
                        null,
                        null,
                        [],
                        IsSuppressed: true,
                        SuppressionReason: "below_minimum_respondents",
                        MinimumGroupSize: SurveyResultsPrivacy.MinimumRespondents),
                ],
                [],
                []),
            Notes: notes);
}
