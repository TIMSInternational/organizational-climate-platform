using System.Globalization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Reports.Rendering;
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
    private const string HeaderFill = "#E1E0D9";
    private const string SectionFill = "#F2F2F2";

    /// <summary>The workbook as bytes.</summary>
    public static byte[] Build(IReadOnlyList<ResultsWorkbookSurvey> surveys, ScoreScale scale, bool spanish, DateOnly generatedOn)
    {
        ArgumentNullException.ThrowIfNull(surveys);

        using var book = new XLWorkbook();
        WriteSummary(book.AddWorksheet(spanish ? "Resumen" : "Summary"), surveys, scale, spanish, generatedOn);
        for (var i = 0; i < surveys.Count; i++)
        {
            var sheet = book.AddWorksheet(StatusWorkbook.SheetName(surveys[i].Title, i + 1, book));
            WriteSurvey(sheet, surveys[i], scale, spanish);
        }

        using var stream = new MemoryStream();
        book.SaveAs(stream);
        return stream.ToArray();
    }

    private static void WriteSummary(IXLWorksheet sheet, IReadOnlyList<ResultsWorkbookSurvey> surveys, ScoreScale scale, bool spanish, DateOnly generatedOn)
    {
        sheet.Cell(1, 1).Value = spanish ? "Resultados agregados" : "Aggregated results";
        sheet.Cell(1, 1).Style.Font.Bold = true;
        sheet.Cell(1, 1).Style.Font.FontSize = 14;
        sheet.Cell(2, 1).Value = (spanish ? "Al " : "As at ") + generatedOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            + (spanish ? " · " : " · ") + (scale == ScoreScale.Percent ? (spanish ? "porcentaje de 0 a 100" : "percentage from 0 to 100") : (spanish ? "media de 1 a 5" : "mean from 1 to 5"));
        sheet.Cell(2, 1).Style.Font.FontColor = XLColor.FromHtml("#595959");

        var headers = spanish
            ? new[] { "Encuesta", "Estado", "Respuestas completas", "Invitadas", "Participación", "Media general", "Nota" }
            : new[] { "Survey", "Status", "Complete responses", "Invited", "Participation", "Overall mean", "Note" };
        Header(sheet, 4, headers);

        var row = 5;
        foreach (var survey in surveys)
        {
            var summary = survey.Aggregate.Summary;
            sheet.Cell(row, 1).Value = survey.Title;
            sheet.Cell(row, 2).Value = survey.Status;
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
                Score(sheet.Cell(row, 6), overall, scale);
            }

            if (survey.Aggregate.IsSuppressed)
            {
                sheet.Cell(row, 7).Value = SuppressedNote(spanish);
            }

            row++;
        }

        row++;
        sheet.Cell(row, 1).Value = spanish
            ? "Un departamento o un valor demográfico se muestra a la administración desde 1 respuesta (decisión del cliente, 15 oct 2026). Para cruzar dos variables, use «Generar informe»: ahí cada grupo necesita 3 personas."
            : "A department or a demographic value is shown to administrators from 1 response (client ruling, 15 Oct 2026). To cross two variables, use «Generate report», where every group needs 3 people.";
        sheet.Cell(row + 1, 1).Value = spanish
            ? "Este archivo no contiene respuestas individuales ni el texto de ningún comentario."
            : "This file contains no individual answers and no comment text.";
        sheet.Range(row, 1, row + 1, 1).Style.Font.FontColor = XLColor.FromHtml("#595959");

        sheet.Column(1).Width = 44;
        sheet.Columns(2, 6).Width = 16;
        sheet.Column(7).Width = 50;
        sheet.SheetView.Freeze(4, 1);
    }

    private static void WriteSurvey(IXLWorksheet sheet, ResultsWorkbookSurvey survey, ScoreScale scale, bool spanish)
    {
        var aggregate = survey.Aggregate;
        var summary = aggregate.Summary;
        var locale = spanish ? "es" : "en";

        sheet.Cell(1, 1).Value = survey.Title;
        sheet.Cell(1, 1).Style.Font.Bold = true;
        sheet.Cell(1, 1).Style.Font.FontSize = 14;
        var participation = summary.InvitedCount is { } invited
            ? (spanish ? $"{summary.CompletedCount} respuestas completas de {invited} personas invitadas" : $"{summary.CompletedCount} complete responses of {invited} people invited")
            : (spanish ? $"{summary.CompletedCount} respuestas completas" : $"{summary.CompletedCount} complete responses");
        sheet.Cell(2, 1).Value = participation;
        sheet.Cell(2, 1).Style.Font.FontColor = XLColor.FromHtml("#595959");

        if (aggregate.IsSuppressed)
        {
            sheet.Cell(4, 1).Value = SuppressedNote(spanish);
            sheet.Column(1).Width = 80;
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
        Section(sheet, row, spanish ? "Por pregunta" : "By question");
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
        Header(sheet, row, headers);
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
                Score(sheet.Cell(row, 6), mean, scale);
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
                    Score(sheet.Cell(row, firstGroupColumn + g), groupMean, scale);
                }
            }

            row++;
        }

        if (row > questionHeaderRow + 1)
        {
            sheet.Range(questionHeaderRow, 1, row - 1, headers.Count).SetAutoFilter();
        }

        // By dimension.
        row += 1;
        Section(sheet, row, spanish ? "Por dimensión" : "By dimension");
        row++;
        var dimensionHeaders = new List<string>(spanish
            ? ["Dimensión", "Preguntas", "Respuestas", "Media"]
            : ["Dimension", "Questions", "Responses", "Mean"]);
        dimensionHeaders.AddRange(groups.Select(g => g.Header));
        Header(sheet, row, dimensionHeaders);
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

            sheet.Cell(row, 1).Value = DimensionNames.Resolve(key, locale);
            sheet.Cell(row, 2).Value = dimension.QuestionCount;
            sheet.Cell(row, 3).Value = dimension.AnsweredCount;
            if (dimension.AverageScore is { } average)
            {
                Score(sheet.Cell(row, 4), average, scale);
            }

            for (var g = 0; g < groups.Count; g++)
            {
                if (segmentScores[g].TryGetValue(key, out var score) && score is { } groupScore)
                {
                    Score(sheet.Cell(row, 5 + g), groupScore, scale);
                }
            }

            row++;
        }

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
            sheet.Cell(row, 1).Style.Font.FontColor = XLColor.FromHtml("#595959");
        }

        sheet.Column(1).Width = 8;
        sheet.Column(2).Width = 22;
        sheet.Column(3).Width = 60;
        sheet.Column(4).Width = 16;
        sheet.Columns(5, Math.Max(6, headers.Count)).Width = 14;
        sheet.Range(questionHeaderRow, 1, questionHeaderRow, headers.Count).Style.Alignment.WrapText = true;
        sheet.SheetView.Freeze(questionHeaderRow, 3);
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

    private static void Header(IXLWorksheet sheet, int row, IReadOnlyList<string> headers)
    {
        for (var c = 0; c < headers.Count; c++)
        {
            var cell = sheet.Cell(row, c + 1);
            cell.Value = headers[c];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml(HeaderFill);
        }
    }

    private static void Section(IXLWorksheet sheet, int row, string title)
    {
        sheet.Cell(row, 1).Value = title;
        sheet.Cell(row, 1).Style.Font.Bold = true;
        sheet.Cell(row, 1).Style.Fill.BackgroundColor = XLColor.FromHtml(SectionFill);
    }

    /// <summary>A reading as a number in the company's scale, formatted as it reads on screen.</summary>
    private static void Score(IXLCell cell, double mean, ScoreScale scale)
    {
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
