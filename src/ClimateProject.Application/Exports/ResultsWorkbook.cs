using System.Globalization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports.Rendering;
using ClimateProject.Application.Reports.SurveyReports;
using ClimateProject.Application.Surveys;
using ClosedXML.Excel;

namespace ClimateProject.Application.Exports;

/// <summary>One survey of the «Resultados agregados» workbook.</summary>
/// <param name="Aggregate">The survey's whole, unfiltered aggregate -- the results screen's own.</param>
/// <param name="Groups">The breakdowns to add as columns: <c>department</c> and/or demographic keys.</param>
public sealed record ResultsWorkbookSurvey(
    string Title,
    string Status,
    SurveyAggregate Aggregate,
    SurveyExportLabels Labels,
    IReadOnlyList<string> Groups);

/// <summary>
/// The «Resultados agregados» workbook of the download wizard: per survey, every closed
/// question's mean and spread, every dimension's mean, and the same by department or by any
/// demographic the wizard ticked.
///
/// ## Only what the results screen already shows, and to the same people
///
/// Every number is read off <see cref="SurveyAggregation.Compute"/>'s whole-survey aggregate,
/// the one <c>GET /surveys/{id}/results</c> serves: a survey under the floor of 3 arrives with no
/// questions and gets a participation line and nothing else; a group is a single variable --
/// one department, one demographic value -- which the client's ruling of 15 Oct 2026 shows to
/// administrators from one respondent, exactly as the results breakdown does. There are no
/// crosses here: a cross is a cohort of two variables, it needs 3 people and the subtraction
/// guard, and it lives in the report PDF, where every cell goes through both.
///
/// ## Never a person's text
///
/// Open questions are left out entirely. Their only aggregate is word frequencies, which are
/// in the report; their content is in exactly one place in the product, the super-admin
/// response workbook (ruled 2026-10-16).
/// </summary>
public static class ResultsWorkbook
{
    /// <summary>The workbook as bytes.</summary>
    /// <param name="bands">
    /// The company's three result areas. Every mean is painted with the area it falls in, from the
    /// same thresholds and the same colours as the results screen and the PDF report. Null paints none.
    /// </param>
    /// <param name="brand">The company's logo and colour; null wears the product's.</param>
    public static byte[] Build(
        IReadOnlyList<ResultsWorkbookSurvey> surveys,
        ScoreScale scale,
        bool spanish,
        DateOnly generatedOn,
        SurveyReportBands? bands = null,
        WorkbookBrand? brand = null)
    {
        ArgumentNullException.ThrowIfNull(surveys);
        brand ??= WorkbookBrand.Product();

        using var book = new XLWorkbook();
        var summaryName = spanish ? "Resumen" : "Summary";
        WriteSummary(book.AddWorksheet(summaryName), surveys, scale, spanish, generatedOn, bands, brand);
        var sheets = new List<WorkbookCoverSheet>
        {
            new(summaryName, spanish
                ? "Cada encuesta en una línea: participación y media general."
                : "Each survey on one line: participation and overall mean."),
        };
        for (var i = 0; i < surveys.Count; i++)
        {
            var sheet = book.AddWorksheet(StatusWorkbook.SheetName(surveys[i].Title, i + 1, book));
            WriteSurvey(sheet, surveys[i], scale, spanish, bands, brand);
            sheets.Add(new(sheet.Name, SheetDescription(surveys[i], spanish)));
        }

        WorkbookCover.Insert(book, brand, Cover(surveys, scale, spanish, generatedOn, bands, brand, sheets), spanish);

        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteSummary(
        IXLWorksheet sheet, IReadOnlyList<ResultsWorkbookSurvey> surveys, ScoreScale scale, bool spanish, DateOnly generatedOn, SurveyReportBands? bands, WorkbookBrand brand)
    {
        sheet.Cell(1, 1).Value = spanish ? "Resultados agregados" : "Aggregated results";
        sheet.Cell(2, 1).Value = (spanish ? "Al " : "As at ") + generatedOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            + (spanish ? " · " : " · ") + ScaleWords(scale, spanish);
        WorkbookStyle.Title(sheet.Cell(1, 1), sheet.Cell(2, 1));

        var headers = spanish
            ? new[] { "Encuesta", "Estado", "Respuestas completas", "Invitadas", "Participación", "Media general", "Nota" }
            : new[] { "Survey", "Status", "Complete responses", "Invited", "Participation", "Overall mean", "Note" };
        WriteHeader(sheet, 4, headers, brand, textColumns: 2);
        sheet.Cell(4, 7).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;

        var row = 5;
        foreach (var survey in surveys)
        {
            var summary = survey.Aggregate.Summary;
            sheet.Cell(row, 1).Value = survey.Title;
            sheet.Cell(row, 2).Value = WorkbookWords.SurveyStatus(survey.Status, spanish);
            sheet.Cell(row, 3).Value = summary.CompletedCount;
            if (summary.InvitedCount is { } invited)
            {
                sheet.Cell(row, 4).Value = invited;
            }

            if (summary.ParticipationRate is { } rate)
            {
                Percent(sheet.Cell(row, 5), rate);
            }

            if (!survey.Aggregate.IsSuppressed && SurveyCrossTabulation.OverallAverage(survey.Aggregate.Questions) is { } overall)
            {
                Score(sheet.Cell(row, 6), overall, scale, bands);
            }

            if (survey.Aggregate.IsSuppressed)
            {
                sheet.Cell(row, 7).Value = SuppressedNote(spanish);
            }

            row++;
        }

        if (row > 5)
        {
            WorkbookStyle.Body(sheet.Range(5, 1, row - 1, headers.Length));
            sheet.Range(5, 3, row - 1, 5).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            sheet.Range(5, 7, row - 1, 7).Style.Alignment.WrapText = true;
            sheet.Range(5, 7, row - 1, 7).Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Secondary);
        }

        sheet.Column(1).Width = 44;
        sheet.Columns(2, 6).Width = 16;
        sheet.Column(7).Width = 50;
        WorkbookStyle.Rows(sheet, 4, 4, 1, headers.Length, WorkbookStyle.HeaderRowHeight);
        WorkbookStyle.Rows(sheet, 5, Math.Max(5, row - 1), 1, headers.Length);
        sheet.SheetView.Freeze(4, 1);
        WorkbookStyle.Print(sheet, brand, spanish, 4);
    }

    private static void WriteSurvey(IXLWorksheet sheet, ResultsWorkbookSurvey survey, ScoreScale scale, bool spanish, SurveyReportBands? bands, WorkbookBrand brand)
    {
        var aggregate = survey.Aggregate;
        var summary = aggregate.Summary;
        var locale = spanish ? "es" : "en";

        sheet.Cell(1, 1).Value = survey.Title;
        var participation = summary.InvitedCount is { } invited
            ? (spanish ? $"{summary.CompletedCount} respuestas completas de {invited} personas invitadas" : $"{summary.CompletedCount} complete responses of {invited} people invited")
            : (spanish ? $"{summary.CompletedCount} respuestas completas" : $"{summary.CompletedCount} complete responses");
        sheet.Cell(2, 1).Value = participation;
        WorkbookStyle.Title(sheet.Cell(1, 1), sheet.Cell(2, 1));

        if (aggregate.IsSuppressed)
        {
            sheet.Cell(4, 1).Value = SuppressedNote(spanish);
            WorkbookStyle.Tone(sheet.Cell(4, 1), WorkbookPalette.Protected, WorkbookPalette.Secondary);
            sheet.Column(1).Width = 80;
            WorkbookStyle.Print(sheet, brand, spanish);
            return;
        }

        // The group columns: every disclosed value of every breakdown the wizard ticked, in the
        // aggregation's own order. A withheld segment is left out, never printed as a zero.
        var groups = new List<(string Header, SurveySegmentResult Segment)>();
        foreach (var field in survey.Groups)
        {
            var breakdown = aggregate.Breakdowns.FirstOrDefault(b => string.Equals(b.Dimension, field, StringComparison.Ordinal));
            if (breakdown is null)
            {
                continue;
            }

            var variable = string.Equals(field, SurveySegmentSelector.DepartmentField, StringComparison.Ordinal)
                ? (spanish ? "Departamento" : "Department")
                : survey.Labels.Dimensions.TryGetValue(field, out var named) ? named : field;
            foreach (var segment in breakdown.Segments.Where(s => !s.IsSuppressed))
            {
                var value = string.Equals(field, SurveySegmentSelector.DepartmentField, StringComparison.Ordinal)
                    ? segment.Label ?? segment.Key
                    : survey.Labels.Options.TryGetValue((field, segment.Key), out var label) ? label : segment.Key;
                groups.Add(($"{variable}: {value} (n = {segment.RespondentCount.ToString(CultureInfo.InvariantCulture)})", segment));
            }
        }

        var closed = aggregate.Questions
            .Select((q, i) => (Question: q, Index: i))
            .Where(t => !QuestionTypes.FreeText.Contains(t.Question.Type, StringComparer.Ordinal))
            .ToList();
        var numeric = closed.Where(t => QuestionTypes.NumericScale.Contains(t.Question.Type, StringComparer.Ordinal)).ToList();
        var pointColumns = numeric.Count > 0 && numeric.All(t => t.Question.ScaleMin == 1 && t.Question.ScaleMax == 5);
        var width = aggregate.Questions.Count >= 100 ? 3 : 2;

        // By question.
        var row = 4;
        var sectionRow = row;
        sheet.Cell(row, 1).Value = spanish ? "Por pregunta" : "By question";
        row++;
        var headers = new List<string>(spanish
            ? ["N.º", "Dimensión", "Pregunta", "Tipo", "Respuestas", "Media"]
            : ["No.", "Dimension", "Question", "Type", "Responses", "Mean"]);
        if (pointColumns)
        {
            headers.AddRange(Enumerable.Range(1, 5).Select(p => $"% {p.ToString(CultureInfo.InvariantCulture)}"));
        }
        else
        {
            headers.Add(spanish ? "Reparto" : "Spread");
        }

        var firstGroupColumn = headers.Count + 1;
        headers.AddRange(groups.Select(g => g.Header));
        WriteHeader(sheet, row, headers, brand);
        WorkbookStyle.Section(sheet.Range(sectionRow, 1, sectionRow, headers.Count), brand);
        var questionHeaderRow = row;
        row++;

        foreach (var (question, index) in closed)
        {
            sheet.Cell(row, 1).Value = "P" + (index + 1).ToString(CultureInfo.InvariantCulture).PadLeft(width, '0');
            if (!string.IsNullOrWhiteSpace(question.Category))
            {
                sheet.Cell(row, 2).Value = DimensionNames.Resolve(question.Category, locale);
            }

            sheet.Cell(row, 3).Value = question.Text ?? string.Empty;
            sheet.Cell(row, 4).Value = QuestionnaireWorkbook.TypeName(question.Type, spanish);
            sheet.Cell(row, 5).Value = question.AnsweredCount;
            if (question.Average is { } mean)
            {
                Score(sheet.Cell(row, 6), mean, scale, bands);
            }

            if (pointColumns)
            {
                if (QuestionTypes.NumericScale.Contains(question.Type, StringComparer.Ordinal))
                {
                    for (var point = 1; point <= 5; point++)
                    {
                        var bucket = question.Distribution.FirstOrDefault(b => b.Value == point.ToString(CultureInfo.InvariantCulture));
                        Percent(sheet.Cell(row, 6 + point), bucket?.Percentage ?? 0);
                    }
                }
                else if (question.Distribution.Count > 0)
                {
                    // A choice question beside 1-5 scales: its options do not map to points, so
                    // they are written out in the first point column rather than forced into five.
                    sheet.Cell(row, 7).Value = Spread(question, spanish);
                }
            }
            else if (question.Distribution.Count > 0)
            {
                sheet.Cell(row, 7).Value = Spread(question, spanish);
            }

            for (var g = 0; g < groups.Count; g++)
            {
                var segmentQuestion = groups[g].Segment.Questions.FirstOrDefault(q => q.QuestionId == question.QuestionId);
                if (segmentQuestion?.Average is { } groupMean)
                {
                    Score(sheet.Cell(row, firstGroupColumn + g), groupMean, scale, bands);
                }
            }

            row++;
        }

        var lastQuestionRow = row - 1;
        if (row > questionHeaderRow + 1)
        {
            sheet.Range(questionHeaderRow, 1, row - 1, headers.Count).SetAutoFilter();
            WorkbookStyle.Body(sheet.Range(questionHeaderRow + 1, 1, row - 1, headers.Count));
            sheet.Range(questionHeaderRow + 1, 3, row - 1, 3).Style.Alignment.WrapText = true;
            sheet.Range(questionHeaderRow + 1, 5, row - 1, 5).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            sheet.Range(questionHeaderRow + 1, 1, row - 1, 1).Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Secondary);
            sheet.Range(questionHeaderRow + 1, 7, row - 1, Math.Max(7, firstGroupColumn - 1)).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            if (!pointColumns)
            {
                sheet.Range(questionHeaderRow + 1, 7, row - 1, 7).Style.Alignment.WrapText = true;
                sheet.Range(questionHeaderRow + 1, 7, row - 1, 7).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
            }
        }

        // By dimension.
        row += 1;
        var dimensionSectionRow = row;
        sheet.Cell(row, 1).Value = spanish ? "Por dimensión" : "By dimension";
        row++;
        // Aligned under the question table: the name under «Dimensión», the count under «Tipo», and
        // the answered count, the mean and every group column under their own, so a dimension's
        // reading sits in the same column as its questions' readings.
        var dimensionHeaders = Enumerable.Repeat(string.Empty, headers.Count).ToList();
        dimensionHeaders[1] = spanish ? "Dimensión" : "Dimension";
        dimensionHeaders[3] = spanish ? "Preguntas" : "Questions";
        dimensionHeaders[4] = spanish ? "Respuestas" : "Responses";
        dimensionHeaders[5] = spanish ? "Media" : "Mean";
        for (var g = 0; g < groups.Count; g++)
        {
            dimensionHeaders[firstGroupColumn - 1 + g] = groups[g].Header;
        }

        WriteHeader(sheet, row, dimensionHeaders, brand);
        WorkbookStyle.Section(sheet.Range(dimensionSectionRow, 1, dimensionSectionRow, dimensionHeaders.Count), brand);
        var dimensionHeaderRow = row;
        row++;

        var segmentScores = groups.Select(g => SurveyAggregation.SegmentDimensionScores(aggregate.Questions, g.Segment)).ToList();
        var order = aggregate.Questions
            .Where(q => !string.IsNullOrWhiteSpace(q.Category))
            .Select(q => q.Category!)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        foreach (var key in order)
        {
            var dimension = aggregate.Dimensions.FirstOrDefault(d => string.Equals(d.Dimension, key, StringComparison.Ordinal));
            if (dimension is null)
            {
                continue;
            }

            sheet.Cell(row, 2).Value = DimensionNames.Resolve(key, locale);
            sheet.Cell(row, 4).Value = dimension.QuestionCount;
            sheet.Cell(row, 5).Value = dimension.AnsweredCount;
            if (dimension.AverageScore is { } average)
            {
                Score(sheet.Cell(row, 6), average, scale, bands);
            }

            for (var g = 0; g < groups.Count; g++)
            {
                if (segmentScores[g].TryGetValue(key, out var score) && score is { } groupScore)
                {
                    Score(sheet.Cell(row, firstGroupColumn + g), groupScore, scale, bands);
                }
            }

            row++;
        }

        if (row > dimensionHeaderRow + 1)
        {
            WorkbookStyle.Body(sheet.Range(dimensionHeaderRow + 1, 1, row - 1, dimensionHeaders.Count));
            sheet.Range(dimensionHeaderRow + 1, 2, row - 1, 2).Style.Font.Bold = true;
            sheet.Range(dimensionHeaderRow + 1, 2, row - 1, 2).Style.Alignment.WrapText = true;
            sheet.Range(dimensionHeaderRow + 1, 4, row - 1, 5).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }

        var lastDimensionRow = row - 1;
        if (order.Count == 0)
        {
            sheet.Cell(row, 1).Value = spanish ? "Ninguna pregunta tiene dimensión." : "No question has a dimension.";
            row++;
        }

        row++;
        if (aggregate.Questions.Any(q => QuestionTypes.FreeText.Contains(q.Type, StringComparer.Ordinal)))
        {
            sheet.Cell(row, 1).Value = spanish
                ? "Las preguntas abiertas no están en este archivo. Sus palabras más frecuentes están en el informe PDF."
                : "Open questions are not in this file. Their most frequent words are in the PDF report.";
            sheet.Cell(row, 1).Style.Font.FontColor = XLColor.FromHtml(WorkbookPalette.Secondary);
        }

        sheet.Column(1).Width = 7;
        sheet.Column(2).Width = 26;
        sheet.Column(3).Width = 60;
        sheet.Column(4).Width = 12;
        sheet.Column(5).Width = 12;
        sheet.Column(6).Width = 10;
        sheet.Columns(7, Math.Max(7, firstGroupColumn - 1)).Width = pointColumns ? 8 : 40;
        if (groups.Count > 0)
        {
            sheet.Columns(firstGroupColumn, firstGroupColumn + groups.Count - 1).Width = 18;
        }

        WorkbookStyle.Rows(sheet, questionHeaderRow, questionHeaderRow, 1, headers.Count, WorkbookStyle.HeaderRowHeight);
        WorkbookStyle.Rows(sheet, questionHeaderRow + 1, Math.Max(questionHeaderRow + 1, lastQuestionRow), 1, headers.Count);
        WorkbookStyle.Rows(sheet, dimensionHeaderRow, dimensionHeaderRow, 1, dimensionHeaders.Count, WorkbookStyle.HeaderRowHeight);
        WorkbookStyle.Rows(sheet, dimensionHeaderRow + 1, Math.Max(dimensionHeaderRow + 1, lastDimensionRow), 1, dimensionHeaders.Count);
        sheet.SheetView.Freeze(questionHeaderRow, 3);
        WorkbookStyle.Print(sheet, brand, spanish, questionHeaderRow);
    }

    private static string ScaleWords(ScoreScale scale, bool spanish)
        => scale == ScoreScale.Percent
            ? (spanish ? "porcentaje de 0 a 100" : "percentage from 0 to 100")
            : (spanish ? "media de 1 a 5" : "mean from 1 to 5");

    private static string SheetDescription(ResultsWorkbookSurvey survey, bool spanish)
    {
        var completed = survey.Aggregate.Summary.CompletedCount.ToString(CultureInfo.InvariantCulture);
        if (survey.Aggregate.IsSuppressed)
        {
            return spanish
                ? $"{completed} respuestas completas: menos de 3, así que solo la participación."
                : $"{completed} complete responses: fewer than 3, so participation only.";
        }

        var questions = survey.Aggregate.Questions.Count(q => !QuestionTypes.FreeText.Contains(q.Type, StringComparer.Ordinal));
        var groups = survey.Groups.Count == 0
            ? string.Empty
            : spanish ? ", con columnas por grupo" : ", with a column per group";
        return spanish
            ? $"{completed} respuestas completas · {questions} preguntas y sus dimensiones{groups}."
            : $"{completed} complete responses · {questions} questions and their dimensions{groups}.";
    }

    private static WorkbookCoverContent Cover(
        IReadOnlyList<ResultsWorkbookSurvey> surveys,
        ScoreScale scale,
        bool spanish,
        DateOnly generatedOn,
        SurveyReportBands? bands,
        WorkbookBrand brand,
        IReadOnlyList<WorkbookCoverSheet> sheets)
    {
        var count = surveys.Count.ToString(CultureInfo.InvariantCulture);
        var company = string.IsNullOrWhiteSpace(brand.CompanyName) ? string.Empty : brand.CompanyName + " · ";
        var legend = new List<WorkbookCoverLegend>();
        if (bands is not null)
        {
            var low = ScaleNumber(bands.OpportunityMin, scale, spanish);
            var high = ScaleNumber(bands.StrengthMin, scale, spanish);
            legend.Add(new(WorkbookPalette.StrengthFill, WorkbookPalette.StrengthInk, bands.StrengthName,
                spanish ? $"Desde {high}." : $"From {high}."));
            legend.Add(new(WorkbookPalette.OpportunityFill, WorkbookPalette.OpportunityInk, bands.OpportunityName,
                spanish ? $"Desde {low} y por debajo de {high}." : $"From {low} and below {high}."));
            legend.Add(new(WorkbookPalette.CriticalFill, WorkbookPalette.CriticalInk, bands.CriticalName,
                spanish ? $"Por debajo de {low}." : $"Below {low}."));
        }

        return new WorkbookCoverContent(
            spanish ? "Resultados agregados" : "Aggregated results",
            company + (spanish ? $"{count} encuesta{(surveys.Count == 1 ? string.Empty : "s")} · {ScaleWords(scale, spanish)}" : $"{count} survey{(surveys.Count == 1 ? string.Empty : "s")} · {ScaleWords(scale, spanish)}"),
            (spanish ? "Generado el " : "Generated on ") + generatedOn.ToString(spanish ? "d 'de' MMMM 'de' yyyy" : "d MMMM yyyy", CultureInfo.GetCultureInfo(spanish ? "es-CR" : "en-US")),
            sheets,
            legend,
            spanish
                ?
                [
                    "Un departamento o un valor demográfico se muestra a la administración desde 1 respuesta (decisión del cliente, 15 oct 2026). Para cruzar dos variables, use «Generar informe»: ahí cada grupo necesita 3 personas.",
                    "Una encuesta con menos de 3 respuestas completas muestra solo su participación.",
                    "Este archivo no contiene respuestas individuales ni el texto de ningún comentario.",
                ]
                :
                [
                    "A department or a demographic value is shown to administrators from 1 response (client ruling, 15 Oct 2026). To cross two variables, use «Generate report», where every group needs 3 people.",
                    "A survey with fewer than 3 complete responses shows only its participation.",
                    "This file contains no individual answers and no comment text.",
                ]);
    }

    private static string ScaleNumber(decimal mean, ScoreScale scale, bool spanish)
    {
        var text = scale == ScoreScale.Percent
            ? (mean * ScoreScales.PercentFactor).ToString("0.#", CultureInfo.InvariantCulture)
            : mean.ToString("0.00", CultureInfo.InvariantCulture);
        return spanish ? text.Replace('.', ',') : text;
    }

    private static string Spread(SurveyQuestionResult question, bool spanish)
        => string.Join(
            " · ",
            question.Distribution.Select(b =>
            {
                var percent = Math.Round(b.Percentage, 1).ToString("0.#", CultureInfo.InvariantCulture);
                return $"{b.Label ?? b.Value}: {(spanish ? percent.Replace('.', ',') : percent)} %";
            }));

    private static string SuppressedNote(bool spanish)
        => spanish
            ? "Menos de 3 respuestas completas: hasta llegar a 3 solo se muestra la participación."
            : "Fewer than 3 complete responses: until it reaches 3, only participation is shown.";

    /// <summary>A header row; every column after the first <paramref name="textColumns"/> holds numbers and is centred.</summary>
    private static void WriteHeader(IXLWorksheet sheet, int row, IReadOnlyList<string> headers, WorkbookBrand brand, int textColumns = 4)
    {
        for (var c = 0; c < headers.Count; c++)
        {
            if (headers[c].Length > 0)
            {
                sheet.Cell(row, c + 1).Value = headers[c];
            }
        }

        WorkbookStyle.Header(sheet.Range(row, 1, row, headers.Count), brand);
        if (headers.Count > textColumns)
        {
            sheet.Range(row, textColumns + 1, row, headers.Count).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }
    }

    /// <summary>
    /// A reading as a number in the company's scale, formatted as it reads on screen, and painted
    /// with its result area. The area is decided on the mean, rounded as it is printed
    /// (<see cref="SurveyReportBands.Of"/>), so a "4,00" is never painted as an opportunity.
    /// </summary>
    private static void Score(IXLCell cell, double mean, ScoreScale scale, SurveyReportBands? bands)
    {
        if (bands is not null)
        {
            var (fill, ink) = bands.Of(mean) switch
            {
                SurveyReportBand.Strength => (WorkbookPalette.StrengthFill, WorkbookPalette.StrengthInk),
                SurveyReportBand.Opportunity => (WorkbookPalette.OpportunityFill, WorkbookPalette.OpportunityInk),
                _ => (WorkbookPalette.CriticalFill, WorkbookPalette.CriticalInk),
            };
            WorkbookStyle.Tone(cell, fill, ink);
            cell.Style.Font.Bold = true;
        }

        cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        if (scale == ScoreScale.Percent)
        {
            cell.Value = Math.Round(mean * (double)ScoreScales.PercentFactor, 1);
            cell.Style.NumberFormat.Format = "0.0";
        }
        else
        {
            cell.Value = Math.Round(mean, 2);
            cell.Style.NumberFormat.Format = "0.00";
        }
    }

    /// <summary>A 0-100 percentage as an Excel percentage, so it sorts and sums as a number.</summary>
    private static void Percent(IXLCell cell, double percent)
    {
        cell.Value = Math.Round(percent / 100d, 4);
        cell.Style.NumberFormat.Format = "0.0%";
    }
}
