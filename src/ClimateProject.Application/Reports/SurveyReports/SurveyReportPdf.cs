using System.Globalization;
using ClimateProject.Application.Exports;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;

namespace ClimateProject.Application.Reports.SurveyReports;

/// <summary>
/// The survey report as a PDF with charts: the document the «Generar informe» wizard produces.
///
/// ## It draws, it never decides
///
/// Everything printed comes off a <see cref="SurveyReportModel"/> that
/// <see cref="SurveyReportBuilder"/> computed from the aggregation. A protected cross cell
/// reaches this class with no number on it at all, so there is nothing here that could print
/// one; the renderer's only privacy duty is to draw every protected cell the same way -- a lock
/// and one word -- and it does, whatever made the cell protected.
///
/// ## The charts are the canvas design's (14 Nov 2026, «Informe PDF (gráficos)»)
///
/// Colours, glyphs and layouts follow the four Pdf-* boards: the climate bar coloured by the
/// company's three areas with the department range in it, the climate map, the cross matrix
/// with protected cells, the answer distribution as a stacked bar. Every area is told by a
/// shape as well as a colour (a triangle up, a dot, a triangle down), so the document survives
/// a black-and-white printer and a reader who does not see red from green.
/// </summary>
public static class SurveyReportPdf
{
    /// <summary>Renders the report.</summary>
    public static PdfDocument Build(SurveyReportModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        var copy = SurveyReportCopy.For(model.Locale);
        var document = new PdfDocument(model.SurveyTitle ?? copy.UntitledSurvey)
        {
            Credit = NexadevCredit.For(model.Locale),
            RunningHeaderBrand = "OCC",
            RunningHeader = string.Join(
                " · ",
                new[] { copy.ProductName, model.CompanyName, model.SurveyTitle }.Where(s => !string.IsNullOrWhiteSpace(s))),
            PageLabelFormat = copy.PageLabelFormat,
        };

        var renderer = new Renderer(document, model, copy);
        renderer.Cover();

        if (model.IsSuppressed)
        {
            renderer.Suppressed();
            return document;
        }

        if (model.Has(SurveyReportSections.Summary))
        {
            renderer.Summary();
        }

        if (model.Has(SurveyReportSections.Dimensions))
        {
            renderer.DimensionBars();
        }

        if (model.Has(SurveyReportSections.Map))
        {
            renderer.Map();
        }

        if (model.Has(SurveyReportSections.Comparison) && model.Comparison is not null)
        {
            renderer.Comparison();
        }

        if (model.Has(SurveyReportSections.Crosses))
        {
            renderer.Crosses();
        }

        if (model.Has(SurveyReportSections.Questions))
        {
            renderer.Questions();
        }

        if (model.Has(SurveyReportSections.Highlights))
        {
            renderer.Highlights();
        }

        if (model.Has(SurveyReportSections.Comments))
        {
            renderer.Comments();
        }

        return document;
    }

    /// <summary>The colours of the design, as named there.</summary>
    internal static class Palette
    {
        public static readonly PdfColor Ink = PdfColor.FromHex("#1D1D1F");
        public static readonly PdfColor Muted = PdfDocument.MutedInk;
        public static readonly PdfColor Separator = PdfColor.FromHex("#E5E7EB");
        public static readonly PdfColor Track = PdfColor.FromHex("#E5E5EA");
        public static readonly PdfColor ProtectedFill = PdfColor.FromHex("#F2F2F4");
        public static readonly PdfColor Accent = PdfColor.FromHex("#2563EB");
        public static readonly PdfColor Dot = PdfColor.FromHex("#0F1A33");
        public static readonly PdfColor WordBar = PdfColor.FromHex("#8E99B3");

        public static readonly PdfColor StrengthBar = PdfColor.FromHex("#30A46C");
        public static readonly PdfColor OpportunityBar = PdfColor.FromHex("#F5A524");
        public static readonly PdfColor CriticalBar = PdfColor.FromHex("#E5484D");
        public static readonly PdfColor StrengthInk = PdfColor.FromHex("#156B32");
        public static readonly PdfColor OpportunityInk = PdfColor.FromHex("#8A5300");
        public static readonly PdfColor CriticalInk = PdfColor.FromHex("#B42318");
        public static readonly PdfColor StrengthFill = PdfColor.FromHex("#E6F4EA");
        public static readonly PdfColor OpportunityFill = PdfColor.FromHex("#FFF3D6");
        public static readonly PdfColor CriticalFill = PdfColor.FromHex("#FDECEA");

        // The answer distribution, from the lowest point of a scale to the highest, with the
        // text colour that reads on each.
        public static readonly (PdfColor Fill, PdfColor Text)[] Distribution =
        [
            (PdfColor.FromHex("#B42318"), PdfColor.White),
            (PdfColor.FromHex("#F2B8B1"), PdfColor.FromHex("#1D1D1F")),
            (PdfColor.FromHex("#D1D1D6"), PdfColor.FromHex("#1D1D1F")),
            (PdfColor.FromHex("#A7DBB8"), PdfColor.FromHex("#1D1D1F")),
            (PdfColor.FromHex("#156B32"), PdfColor.White),
        ];

        public static PdfColor InkOf(SurveyReportBand band) => band switch
        {
            SurveyReportBand.Strength => StrengthInk,
            SurveyReportBand.Opportunity => OpportunityInk,
            _ => CriticalInk,
        };

        public static PdfColor FillOf(SurveyReportBand band) => band switch
        {
            SurveyReportBand.Strength => StrengthFill,
            SurveyReportBand.Opportunity => OpportunityFill,
            _ => CriticalFill,
        };
    }

    private sealed class Renderer(PdfDocument doc, SurveyReportModel model, SurveyReportCopy copy)
    {
        private const double Left = 56;
        private const double Right = 539;
        private const double Width = Right - Left;
        private const double PageTop = 842 - 56;

        private const PdfStandardFont Regular = PdfStandardFont.Regular;
        private const PdfStandardFont Bold = PdfStandardFont.Bold;

        private bool _protectionExplained;

        // ------------------------------------------------------------------
        // Cover and summary
        // ------------------------------------------------------------------

        public void Cover()
        {
            doc.DisplayTitle(model.SurveyTitle);

            var parts = new List<string> { copy.ReportKind };
            if (!string.IsNullOrWhiteSpace(model.CompanyName))
            {
                parts.Add(model.CompanyName);
            }

            if (model.Has(SurveyReportSections.Map) || model.Has(SurveyReportSections.Dimensions))
            {
                var shown = model.Departments.Count;
                parts.Add(model.OmittedDepartmentCount > 0
                    ? $"{copy.Count(shown)} {copy.Of} {copy.Count(shown + model.OmittedDepartmentCount)} {copy.Departments}"
                    : copy.AllDepartments);
            }

            if (model.Crosses.Count > 0)
            {
                parts.Add($"{copy.Crosses}: {string.Join(", ", model.Crosses.Select(CrossTitle))}");
            }

            if (model.Comparison is { Title: { } compared })
            {
                parts.Add($"{copy.ComparedWith} {compared}");
            }

            doc.Paragraph(string.Join(" · ", parts), Regular, 9.5, Palette.Muted);
            doc.Paragraph(
                $"{string.Format(CultureInfo.InvariantCulture, copy.GeneratedOn, copy.Date(model.GeneratedAt))} · {(model.Scale == ScoreScale.Percent ? copy.ScalePercent : copy.ScaleMean)}",
                Regular,
                8,
                Palette.Muted);
            doc.Spacer(6);
        }

        public void Suppressed()
        {
            ParticipationOnly();
            doc.SectionTitle(copy.SuppressedTitle, null, 40);
            doc.Paragraph(copy.SuppressedBody, Regular, 9.5, Palette.Ink);
        }

        public void Summary()
        {
            var kpiHeight = 88.0;
            var gap = 8.0;
            var boxWidth = (Width - (3 * gap)) / 4;
            var top = doc.Reserve(kpiHeight + 8);

            // Media general
            var overall = model.OverallAverage;
            Kpi(Left, top, boxWidth, kpiHeight, copy.OverallMean,
                overall is { } o ? copy.Score(o, model.Scale) : "—",
                overall is { } ov ? model.Bands.Of(ov) : null,
                null,
                OverallFoot());

            // Participación
            var participation = model.Participation;
            Kpi(Left + (boxWidth + gap), top, boxWidth, kpiHeight, copy.Participation,
                participation.ParticipationRate is { } rate ? copy.Percent(rate) : copy.Count(participation.CompletedCount),
                null,
                participation.ParticipationRate,
                participation.InvitedCount is { } invited
                    ? string.Format(CultureInfo.InvariantCulture, copy.ResponsesOf, copy.Count(participation.CompletedCount), copy.Count(invited))
                    : string.Format(CultureInfo.InvariantCulture, copy.Responses, copy.Count(participation.CompletedCount)));

            var banded = model.Dimensions.Where(d => d.Average is not null).ToList();
            var strengths = banded.Where(d => model.Bands.Of(d.Average!.Value) == SurveyReportBand.Strength).ToList();
            var opportunities = banded.Where(d => model.Bands.Of(d.Average!.Value) == SurveyReportBand.Opportunity).ToList();
            var critical = banded.Where(d => model.Bands.Of(d.Average!.Value) == SurveyReportBand.Critical).ToList();

            Kpi(Left + (2 * (boxWidth + gap)), top, boxWidth, kpiHeight, KpiLabel(SurveyReportBand.Strength, copy.StrengthsKpi),
                $"{copy.Count(strengths.Count)} {copy.Of} {copy.Count(banded.Count)}",
                null, null,
                string.Join(", ", strengths.Select(d => d.Name)));

            Kpi(Left + (3 * (boxWidth + gap)), top, boxWidth, kpiHeight, KpiLabel(SurveyReportBand.Opportunity, copy.OpportunitiesKpi),
                $"{copy.Count(opportunities.Count)} {copy.Of} {copy.Count(banded.Count)}",
                null, null,
                critical.Count == 0
                    ? copy.NoneCritical
                    : $"{KpiLabel(SurveyReportBand.Critical, copy.CriticalKpi)}: {string.Join(", ", critical.Select(d => d.Name))}");

            doc.Spacer(kpiHeight + 14);

            // The three highest and lowest questions, side by side.
            var scale = model.Questions.Where(q => q.IsBandedScale && q.AnsweredCount > 0).ToList();
            if (scale.Count > 0)
            {
                var columnWidth = (Width - 20) / 2;
                var high = scale.OrderByDescending(q => q.Average).ThenBy(q => q.Code, StringComparer.Ordinal).Take(3).ToList();
                var low = scale.OrderBy(q => q.Average).ThenBy(q => q.Code, StringComparer.Ordinal).Take(3).ToList();
                var height = Math.Max(RankedListHeight(high, columnWidth), RankedListHeight(low, columnWidth)) + 22;
                var listTop = doc.Reserve(height);
                doc.DrawString(copy.Highest, Left, listTop - 12, PdfStandardFont.SerifBold, 12.5, Palette.Ink);
                doc.DrawString(copy.Lowest, Left + columnWidth + 20, listTop - 12, PdfStandardFont.SerifBold, 12.5, Palette.Ink);
                RankedList(high, Left, listTop - 22, columnWidth);
                RankedList(low, Left + columnWidth + 20, listTop - 22, columnWidth);
                doc.Spacer(height);
            }

            doc.Paragraph(copy.PrivacyNote, Regular, 7.5, Palette.Muted);
        }

        private void ParticipationOnly()
        {
            var participation = model.Participation;
            var height = 78.0;
            var top = doc.Reserve(height + 8);
            Kpi(Left, top, (Width - 24) / 4, height, copy.Participation,
                participation.ParticipationRate is { } rate ? copy.Percent(rate) : copy.Count(participation.CompletedCount),
                null,
                participation.ParticipationRate,
                participation.InvitedCount is { } invited
                    ? string.Format(CultureInfo.InvariantCulture, copy.ResponsesOf, copy.Count(participation.CompletedCount), copy.Count(invited))
                    : string.Format(CultureInfo.InvariantCulture, copy.Responses, copy.Count(participation.CompletedCount)));
            doc.Spacer(height + 10);
        }

        private string OverallFoot()
        {
            if (model.Comparison is { IsSuppressed: false, OverallBefore: { } before, Title: var title } && model.OverallAverage is { } now)
            {
                var delta = now - before;
                var direction = Math.Round(Math.Abs(delta), 2) == 0 ? copy.NoChange : delta > 0 ? copy.Rises : copy.Falls;
                return $"{title}: {copy.Score(before, model.Scale)} · {direction} {copy.Delta(delta, model.Scale)}";
            }

            return string.Format(CultureInfo.InvariantCulture, copy.Responses, copy.Count(model.Participation.CompletedCount));
        }

        private string KpiLabel(SurveyReportBand band, string fallback)
        {
            var (critical, opportunity, strength) = copy.DefaultBandNames;
            var name = model.Bands.NameOf(band);
            var defaultName = band switch
            {
                SurveyReportBand.Strength => strength,
                SurveyReportBand.Opportunity => opportunity,
                _ => critical,
            };

            // The company renamed its areas: say its words, not the product's plural.
            return string.Equals(name, defaultName, StringComparison.Ordinal) ? fallback : name;
        }

        private void Kpi(double x, double top, double width, double height, string label, string value, SurveyReportBand? band, double? meter, string? foot)
        {
            doc.StrokeRectangle(x, top - height, width, height, Palette.Separator, 0.8, 6);
            var inner = x + 10;
            var innerWidth = width - 20;
            doc.DrawString(PdfDocument.Fit(label.ToUpperInvariant(), Bold, 6.5, innerWidth), inner, top - 15, Bold, 6.5, Palette.Muted);
            doc.DrawString(PdfDocument.Fit(value, Bold, 19, innerWidth), inner, top - 37, Bold, 19, Palette.Ink);

            var lineY = top - 47;
            if (band is { } b)
            {
                Chip(inner, lineY - 2, b);
                lineY -= 14;
            }
            else if (meter is { } m)
            {
                doc.FillRectangle(inner, lineY - 4, innerWidth, 4.5, Palette.Track, 2.25);
                doc.FillRectangle(inner, lineY - 4, innerWidth * Math.Clamp(m / 100d, 0, 1), 4.5, Palette.Accent, 2.25);
                lineY -= 10;
            }

            if (!string.IsNullOrWhiteSpace(foot))
            {
                var lines = PdfDocument.WrapText(foot, Regular, 7, innerWidth);
                var room = (int)Math.Max(1, Math.Floor((lineY - (top - height) - 4) / 8.5));
                for (var i = 0; i < Math.Min(lines.Count, room); i++)
                {
                    var text = i == room - 1 && lines.Count > room ? PdfDocument.Fit(lines[i] + " …", Regular, 7, innerWidth) : lines[i];
                    doc.DrawString(text, inner, lineY - 6 - (i * 8.5), Regular, 7, Palette.Muted);
                }
            }
        }

        private double RankedListHeight(IReadOnlyList<SurveyReportQuestion> questions, double width)
            => questions.Sum(q => (PdfDocument.WrapText($"{q.Code} {q.Text}", Regular, 8.5, width - 34).Count * 10.5) + 4);

        private void RankedList(IReadOnlyList<SurveyReportQuestion> questions, double x, double top, double width)
        {
            var y = top;
            foreach (var q in questions)
            {
                var band = model.Bands.Of(q.Average!.Value);
                var ink = band == SurveyReportBand.Critical ? Palette.CriticalInk : Palette.Ink;
                doc.DrawString(copy.Score(q.Average.Value, model.Scale), x, y - 9, Bold, 8.5, ink);
                var lines = PdfDocument.WrapText($"{q.Code} {q.Text}", Regular, 8.5, width - 34);
                for (var i = 0; i < lines.Count; i++)
                {
                    doc.DrawString(lines[i], x + 34, y - 9 - (i * 10.5), Regular, 8.5, Palette.Ink);
                }

                y -= (lines.Count * 10.5) + 4;
            }
        }

        // ------------------------------------------------------------------
        // Climate by dimension
        // ------------------------------------------------------------------

        public void DimensionBars()
        {
            var rows = model.Dimensions.Where(d => d.Average is not null).ToList();
            if (rows.Count == 0)
            {
                return;
            }

            var anyRange = rows.Any(d => d.Low is not null);
            KeepTogether(60 + (rows.Count * 26) + 40);
            doc.SectionTitle(copy.DimensionsTitle, anyRange ? copy.DimensionsSubtitle : copy.DimensionsSubtitleNoDepartments, 60);

            const double labelWidth = 150;
            const double valueWidth = 92;
            const double rowHeight = 26;
            var barLeft = Left + labelWidth + 10;
            var barWidth = Width - labelWidth - valueWidth - 20;

            foreach (var dimension in rows)
            {
                var top = doc.Reserve(rowHeight);
                doc.StrokeLine(Left, top, Right, top, Palette.Separator, 0.5);

                doc.DrawString(PdfDocument.Fit(dimension.Name, Bold, 8.5, labelWidth), Left, top - 11, Bold, 8.5, Palette.Ink);
                if (dimension.Low is { } low && dimension.High is { } high)
                {
                    doc.DrawString(
                        string.Format(CultureInfo.InvariantCulture, copy.RangeFromTo, copy.Score(low, model.Scale), copy.Score(high, model.Scale)),
                        Left, top - 21, Regular, 7, Palette.Muted);
                }

                ClimateBar(barLeft, top - 16, barWidth, 7, dimension.Average!.Value, dimension.Low, dimension.High);

                var band = model.Bands.Of(dimension.Average.Value);
                var valueText = copy.Score(dimension.Average.Value, model.Scale);
                doc.DrawString(valueText, Right, top - 16, Bold, 10, Palette.Ink, PdfTextAlign.Right);
                var chipRight = Right - PdfStandardFontMetrics.MeasureText(valueText, Bold, 10) - 6;
                Chip(chipRight - ChipWidth(band), top - 13.5, band);

                doc.Spacer(rowHeight);
            }

            // The axis, under the bars.
            var axisTop = doc.Reserve(24);
            for (var point = 1; point <= 5; point++)
            {
                var x = barLeft + (barWidth * (point - 1) / 4d);
                doc.DrawString(AxisLabel(point), x, axisTop - 9, Regular, 7, Palette.Muted, PdfTextAlign.Center);
            }

            doc.Spacer(14);
            Legend();
        }

        private string AxisLabel(int point)
            => model.Scale == ScoreScale.Percent
                ? (point * 20).ToString(CultureInfo.InvariantCulture)
                : point.ToString(CultureInfo.InvariantCulture);

        /// <summary>
        /// The climate bar: the 1-5 track coloured by the company's areas, greyed outside the
        /// departments' range, with the organisation's mean as a dot.
        /// </summary>
        private void ClimateBar(double x, double y, double width, double height, double mean, double? low, double? high)
        {
            double At(double value) => x + (width * (Math.Clamp(value, 1, 5) - 1) / 4d);

            // A grey track, then the company's three areas painted only across the span the
            // departments cover -- the whole track when there is no department range to show.
            doc.FillRectangle(x, y, width, height, Palette.Track, height / 2);
            var from = low ?? 1;
            var to = high ?? 5;
            var opportunity = (double)model.Bands.OpportunityMin;
            var strength = (double)model.Bands.StrengthMin;
            foreach (var (zoneFrom, zoneTo, fill) in new[]
                     {
                         (1d, opportunity, Palette.CriticalBar),
                         (opportunity, strength, Palette.OpportunityBar),
                         (strength, 5d, Palette.StrengthBar),
                     })
            {
                var start = Math.Max(zoneFrom, from);
                var end = Math.Min(zoneTo, to);
                if (end > start)
                {
                    doc.FillRectangle(At(start), y, At(end) - At(start), height, fill);
                }
            }

            var dot = At(mean);
            doc.FillCircle(dot, y + (height / 2), 5, PdfColor.White);
            doc.FillCircle(dot, y + (height / 2), 3.6, Palette.Dot);
        }

        private void Legend()
        {
            var top = doc.Reserve(14);
            var x = Left;
            foreach (var band in new[] { SurveyReportBand.Strength, SurveyReportBand.Opportunity, SurveyReportBand.Critical })
            {
                Glyph(x + 3, top - 5.5, band, 3);
                var text = $"{model.Bands.NameOf(band)} {BandRange(band)}";
                doc.DrawString(text, x + 9, top - 8, Regular, 7, Palette.Muted);
                x += PdfStandardFontMetrics.MeasureText(text, Regular, 7) + 22;
            }

            doc.Spacer(14);
        }

        private string BandRange(SurveyReportBand band)
        {
            var opportunity = copy.Score((double)model.Bands.OpportunityMin, model.Scale);
            var strength = copy.Score((double)model.Bands.StrengthMin, model.Scale);
            var belowStrength = copy.Score((double)(model.Bands.StrengthMin - 0.01m), model.Scale);
            return band switch
            {
                SurveyReportBand.Strength => string.Format(CultureInfo.InvariantCulture, copy.BandFrom, strength),
                SurveyReportBand.Opportunity => $"{opportunity}–{belowStrength}",
                _ => string.Format(CultureInfo.InvariantCulture, copy.BandUnder, opportunity),
            };
        }

        // ------------------------------------------------------------------
        // Climate map
        // ------------------------------------------------------------------

        public void Map()
        {
            var tables = (int)Math.Ceiling(model.Dimensions.Count(d => d.Average is not null) / 8d);
            KeepTogether(70 + (tables * (40 + (model.Departments.Count * 20.5))) + 40);
            doc.SectionTitle(copy.MapTitle, copy.MapSubtitle, 80);

            var dimensions = model.Dimensions.Where(d => d.Average is not null).ToList();
            if (model.Departments.Count == 0 || dimensions.Count == 0)
            {
                doc.Paragraph(copy.NoDepartments, Regular, 9, Palette.Muted);
                return;
            }

            const int perTable = 8;
            for (var start = 0; start < dimensions.Count; start += perTable)
            {
                var chunk = dimensions.Skip(start).Take(perTable).ToList();
                MapTable(chunk);
                doc.Spacer(8);
            }

            Legend();
            if (model.OmittedDepartmentCount > 0)
            {
                doc.Paragraph(string.Format(CultureInfo.InvariantCulture, copy.MapOmitted, copy.Count(model.OmittedDepartmentCount)), Regular, 7.5, Palette.Muted);
            }

            doc.Paragraph(copy.MapSingleFloor, Regular, 7.5, Palette.Muted);
        }

        private void MapTable(IReadOnlyList<SurveyReportDimension> dimensions)
        {
            const double labelWidth = 128;
            const double gap = 2.5;
            const double rowHeight = 18;
            var cellWidth = (Width - labelWidth - (gap * dimensions.Count)) / dimensions.Count;

            double Header()
            {
                var lineSets = dimensions.Select(d => HeaderLines(d.Name, 6.5, cellWidth - 2, 3)).ToList();
                var lines = lineSets.Max(l => l.Lines.Count);
                var height = (lines * 7.5) + 6;
                var top = doc.Reserve(height + rowHeight);
                for (var i = 0; i < dimensions.Count; i++)
                {
                    var center = Left + labelWidth + gap + (i * (cellWidth + gap)) + (cellWidth / 2);
                    var (set, size) = lineSets[i];
                    var offset = lines - set.Count;
                    for (var l = 0; l < set.Count; l++)
                    {
                        doc.DrawString(set[l], center, top - 7 - ((offset + l) * 7.5), Bold, size, Palette.Muted, PdfTextAlign.Center);
                    }
                }

                doc.Spacer(height);
                return height;
            }

            Header();
            foreach (var department in model.Departments)
            {
                var pages = doc.PageCount;
                var top = doc.Reserve(rowHeight + gap);
                if (doc.PageCount != pages)
                {
                    Header();
                    top = doc.CursorY;
                }

                var count = copy.Count(department.RespondentCount);
                var countWidth = PdfStandardFontMetrics.MeasureText(count, Regular, 7);
                var name = PdfDocument.Fit(department.Name, Bold, 7.5, labelWidth - countWidth - 10);
                doc.DrawString(name, Left, top - 11.5, Bold, 7.5, Palette.Ink);
                doc.DrawString(count, Left + PdfStandardFontMetrics.MeasureText(name, Bold, 7.5) + 4, top - 11.5, Regular, 7, Palette.Muted);

                for (var i = 0; i < dimensions.Count; i++)
                {
                    var x = Left + labelWidth + gap + (i * (cellWidth + gap));
                    var value = department.DimensionAverages.TryGetValue(dimensions[i].Key, out var v) ? v : null;
                    ScoreCell(x, top - rowHeight, cellWidth, rowHeight, value, 7.5);
                }

                doc.Spacer(rowHeight + gap);
            }
        }

        /// <summary>A cell coloured by its area, with the area's glyph and the value.</summary>
        private void ScoreCell(double x, double y, double width, double height, double? value, double size)
        {
            if (value is not { } mean)
            {
                doc.FillRectangle(x, y, width, height, Palette.ProtectedFill, 3);
                doc.DrawString("—", x + (width / 2), y + (height / 2) - (size * 0.35), Regular, size, Palette.Muted, PdfTextAlign.Center);
                return;
            }

            var band = model.Bands.Of(mean);
            doc.FillRectangle(x, y, width, height, Palette.FillOf(band), 3);
            var text = copy.Score(mean, model.Scale);
            var textWidth = PdfStandardFontMetrics.MeasureText(text, Bold, size);
            var glyphSize = size * 0.32;
            var total = textWidth + (glyphSize * 2) + 2.5;
            var start = x + ((width - total) / 2);
            var baseline = y + (height / 2) - (size * 0.35);
            if (total <= width - 2)
            {
                Glyph(start + glyphSize, baseline + (size * 0.33), band, glyphSize);
                doc.DrawString(text, start + (glyphSize * 2) + 2.5, baseline, Bold, size, Palette.InkOf(band));
            }
            else
            {
                doc.DrawString(text, x + (width / 2), baseline, Bold, size, Palette.InkOf(band), PdfTextAlign.Center);
            }
        }

        // ------------------------------------------------------------------
        // Crosses
        // ------------------------------------------------------------------

        public void Crosses()
        {
            foreach (var cross in model.Crosses)
            {
                var rows = cross.Table.Rows.Count;
                var chunks = Math.Max(1, (int)Math.Ceiling(cross.Table.Columns.Count / 5d));
                KeepTogether(cross.ColumnName is null
                    ? 70 + (rows * 17) + 30
                    : 80 + (chunks * (30 + (rows * 33.5))) + 70);
                if (cross.ColumnName is null)
                {
                    SingleVariable(cross);
                }
                else
                {
                    CrossMatrix(cross);
                }
            }
        }

        private string CrossTitle(SurveyReportCross cross)
            => cross.ColumnName is null
                ? string.Format(CultureInfo.InvariantCulture, copy.SingleVariableTitleFormat, cross.RowName)
                : string.Format(CultureInfo.InvariantCulture, copy.CrossTitleFormat, cross.RowName, cross.ColumnName);

        private void SingleVariable(SurveyReportCross cross)
        {
            doc.SectionTitle(CrossTitle(cross), copy.SingleVariableSubtitle, 60);
            var rows = cross.Table.Rows
                .OrderByDescending(r => r.Average ?? double.MinValue)
                .ThenBy(r => cross.RowValueNames[r.Key], StringComparer.Ordinal)
                .ToList();
            if (rows.Count == 0)
            {
                doc.Paragraph(copy.NoCrossValues, Regular, 9, Palette.Muted);
                return;
            }

            const double labelWidth = 160;
            const double valueWidth = 104;
            const double rowHeight = 17;
            var barLeft = Left + labelWidth + 8;
            var barWidth = Width - labelWidth - valueWidth - 16;

            foreach (var row in rows)
            {
                var top = doc.Reserve(rowHeight);
                doc.DrawString(PdfDocument.Fit(cross.RowValueNames[row.Key], Regular, 8, labelWidth), Left, top - 11, Regular, 8, Palette.Ink);
                doc.FillRectangle(barLeft, top - 12, barWidth, 6, Palette.Track, 3);
                if (row.Average is { } mean)
                {
                    var band = model.Bands.Of(mean);
                    var fill = band switch
                    {
                        SurveyReportBand.Strength => Palette.StrengthBar,
                        SurveyReportBand.Opportunity => Palette.OpportunityBar,
                        _ => Palette.CriticalBar,
                    };
                    doc.FillRectangle(barLeft, top - 12, barWidth * (Math.Clamp(mean, 1, 5) - 1) / 4d, 6, fill, 3);
                    Glyph(Right - valueWidth + 14, top - 9, band, 2.6);
                    doc.DrawString(copy.Score(mean, model.Scale), Right - valueWidth + 22, top - 11.5, Bold, 8.5, Palette.InkOf(band));
                }

                doc.DrawString(copy.PeopleCount(row.RespondentCount), Right, top - 11.5, Regular, 7.5, Palette.Muted, PdfTextAlign.Right);
                doc.Spacer(rowHeight);
            }

            doc.Spacer(6);
            Legend();
        }

        private void CrossMatrix(SurveyReportCross cross)
        {
            doc.SectionTitle(CrossTitle(cross), copy.CrossSubtitle, 90);
            var table = cross.Table;
            if (table.Rows.Count == 0 || table.Columns.Count == 0)
            {
                doc.Paragraph(copy.NoCrossValues, Regular, 9, Palette.Muted);
                return;
            }

            const int perTable = 5;
            for (var start = 0; start < table.Columns.Count; start += perTable)
            {
                var columns = table.Columns.Skip(start).Take(perTable).ToList();
                MatrixTable(cross, columns, includeTotal: start + perTable >= table.Columns.Count);
                doc.Spacer(10);
            }

            Legend();
            if (table.ProtectedCount > 0)
            {
                if (!_protectionExplained)
                {
                    doc.Paragraph(copy.ProtectedExplanation, Regular, 7.5, Palette.Muted);
                    _protectionExplained = true;
                }

                doc.Paragraph(copy.ProtectedNoNumber, Regular, 7.5, Palette.Muted);
            }
        }

        private void MatrixTable(SurveyReportCross cross, IReadOnlyList<CrossTabMarginal> columns, bool includeTotal)
        {
            const double labelWidth = 120;
            const double gap = 3.5;
            const double rowHeight = 30;
            var cellCount = columns.Count + (includeTotal ? 1 : 0);
            var cellWidth = (Width - labelWidth - (gap * cellCount)) / cellCount;

            void Header()
            {
                var headers = columns.Select(c => cross.ColumnValueNames[c.Key]).ToList();
                if (includeTotal)
                {
                    headers.Add(copy.WholeRow);
                }

                var lineSets = headers.Select(h => HeaderLines(h, 7, cellWidth - 4, 2)).ToList();
                var lines = lineSets.Max(l => l.Lines.Count);
                var height = (lines * 8.5) + 5;
                var top = doc.Reserve(height + rowHeight);
                for (var i = 0; i < headers.Count; i++)
                {
                    var center = Left + labelWidth + gap + (i * (cellWidth + gap)) + (cellWidth / 2);
                    var (set, size) = lineSets[i];
                    var offset = lines - set.Count;
                    for (var l = 0; l < set.Count; l++)
                    {
                        doc.DrawString(set[l], center, top - 7.5 - ((offset + l) * 8.5), Bold, size, Palette.Muted, PdfTextAlign.Center);
                    }
                }

                doc.Spacer(height);
            }

            Header();
            foreach (var row in cross.Table.Rows)
            {
                var pages = doc.PageCount;
                var top = doc.Reserve(rowHeight + gap);
                if (doc.PageCount != pages)
                {
                    Header();
                    top = doc.CursorY;
                }

                var nameLines = PdfDocument.WrapText(cross.RowValueNames[row.Key], Bold, 8, labelWidth - 6).Take(2).ToList();
                var nameTop = top - (rowHeight / 2) + ((nameLines.Count - 1) * 4.5) - 3;
                for (var l = 0; l < nameLines.Count; l++)
                {
                    var text = l == 1 && PdfDocument.WrapText(cross.RowValueNames[row.Key], Bold, 8, labelWidth - 6).Count > 2
                        ? PdfDocument.Fit(nameLines[l] + " …", Bold, 8, labelWidth - 6)
                        : nameLines[l];
                    doc.DrawString(text, Left, nameTop - (l * 9), Bold, 8, Palette.Ink);
                }

                for (var i = 0; i < columns.Count; i++)
                {
                    var x = Left + labelWidth + gap + (i * (cellWidth + gap));
                    var cell = cross.Table.Cell(row.Key, columns[i].Key);
                    if (cell is { IsDisclosed: true, Average: { } mean, RespondentCount: { } n })
                    {
                        CrossCell(x, top - rowHeight, cellWidth, rowHeight, mean, n, outlined: false);
                    }
                    else
                    {
                        ProtectedCell(x, top - rowHeight, cellWidth, rowHeight);
                    }
                }

                if (includeTotal)
                {
                    var x = Left + labelWidth + gap + (columns.Count * (cellWidth + gap));
                    if (row.Average is { } total)
                    {
                        CrossCell(x, top - rowHeight, cellWidth, rowHeight, total, row.RespondentCount, outlined: true);
                    }
                    else
                    {
                        doc.StrokeRectangle(x, top - rowHeight, cellWidth, rowHeight, Palette.Separator, 0.8, 4);
                        doc.DrawString(copy.PeopleCount(row.RespondentCount), x + (cellWidth / 2), top - 18, Regular, 7, Palette.Muted, PdfTextAlign.Center);
                    }
                }

                doc.Spacer(rowHeight + gap);
            }
        }

        private void CrossCell(double x, double y, double width, double height, double mean, int respondents, bool outlined)
        {
            var band = model.Bands.Of(mean);
            if (outlined)
            {
                doc.StrokeRectangle(x, y, width, height, Palette.Separator, 0.8, 4);
            }
            else
            {
                doc.FillRectangle(x, y, width, height, Palette.FillOf(band), 4);
            }

            var text = copy.Score(mean, model.Scale);
            var textWidth = PdfStandardFontMetrics.MeasureText(text, Bold, 10);
            var start = x + ((width - textWidth - 8) / 2);
            Glyph(start + 2.5, y + height - 11, band, 2.6);
            doc.DrawString(text, start + 8, y + height - 14, Bold, 10, Palette.InkOf(band));
            doc.DrawString(PdfDocument.Fit(copy.PeopleCount(respondents), Regular, 6.5, width - 4), x + (width / 2), y + 6, Regular, 6.5, Palette.Muted, PdfTextAlign.Center);
        }

        /// <summary>
        /// The one way a protected cell is drawn: grey, a lock, one word. Never a count, never a
        /// mean, never a different look for a different reason.
        /// </summary>
        private void ProtectedCell(double x, double y, double width, double height)
        {
            doc.FillRectangle(x, y, width, height, Palette.ProtectedFill, 4);
            var word = PdfDocument.Fit(copy.Protected, Bold, 7, width - 16);
            var wordWidth = PdfStandardFontMetrics.MeasureText(word, Bold, 7);
            var start = x + ((width - wordWidth - 10) / 2);
            Lock(start + 3, y + (height / 2) - 1.5);
            doc.DrawString(word, start + 10, y + (height / 2) - 2.5, Bold, 7, Palette.Muted);
        }

        private void Lock(double centerX, double bottomY)
        {
            doc.StrokeCircle(centerX, bottomY + 4.6, 1.9, Palette.Muted, 0.9);
            doc.FillRectangle(centerX - 2.9, bottomY, 5.8, 4.4, Palette.Muted, 0.8);
        }

        // ------------------------------------------------------------------
        // Questions
        // ------------------------------------------------------------------

        public void Questions()
        {
            if (model.Questions.Count == 0)
            {
                return;
            }

            NewPageUnlessFresh();
            doc.SectionTitle(copy.QuestionsTitle, copy.QuestionsSubtitle, 60);

            const double barWidth = 190;
            const double valueWidth = 54;
            var textWidth = Width - barWidth - valueWidth - 20;

            string? currentDimension = "\u0000";
            foreach (var question in model.Questions)
            {
                var dimension = question.DimensionName ?? copy.NoDimension;
                if (!string.Equals(dimension, currentDimension, StringComparison.Ordinal))
                {
                    var headTop = doc.Reserve(40);
                    doc.DrawString(PdfDocument.Fit(dimension.ToUpperInvariant(), Bold, 7, Width), Left, headTop - 12, Bold, 7, Palette.Muted);
                    doc.Spacer(16);
                    currentDimension = dimension;
                }

                var isScale = question.ScaleMin is not null && question.ScaleMax is not null
                              && QuestionTypes.NumericScale.Contains(question.Type, StringComparer.Ordinal);
                if (isScale)
                {
                    ScaleQuestion(question, textWidth, barWidth, valueWidth);
                }
                else
                {
                    ChoiceQuestion(question, textWidth);
                }
            }
        }

        private void ScaleQuestion(SurveyReportQuestion question, double textWidth, double barWidth, double valueWidth)
        {
            var lines = PdfDocument.WrapText($"{question.Code} {question.Text}", Regular, 8, textWidth);
            var height = Math.Max((lines.Count * 9.5) + 8, 30);
            var top = doc.Reserve(height);
            doc.StrokeLine(Left, top, Right, top, Palette.Separator, 0.5);
            for (var i = 0; i < lines.Count; i++)
            {
                if (i == 0)
                {
                    doc.DrawString(question.Code, Left, top - 10, Bold, 8, Palette.Ink);
                    var codeWidth = PdfStandardFontMetrics.MeasureText(question.Code + " ", Bold, 8);
                    doc.DrawString(lines[0].Length > question.Code.Length ? lines[0][(question.Code.Length + 1)..] : string.Empty, Left + codeWidth, top - 10, Regular, 8, Palette.Ink);
                }
                else
                {
                    doc.DrawString(lines[i], Left, top - 10 - (i * 9.5), Regular, 8, Palette.Ink);
                }
            }

            var barX = Left + textWidth + 10;
            var barY = top - 17;
            StackedBar(question, barX, barY, barWidth, 11);

            // The scale's own words for its two ends, under the bar -- the question's, never the
            // first and last answers that happened to be given.
            {
                var first = question.ScaleLabelMin;
                var last = question.ScaleLabelMax;
                if (!string.IsNullOrWhiteSpace(first))
                {
                    doc.DrawString(PdfDocument.Fit(first, Regular, 6, (barWidth / 2) - 4), barX, barY - 8, Regular, 6, Palette.Muted);
                }

                if (!string.IsNullOrWhiteSpace(last))
                {
                    doc.DrawString(PdfDocument.Fit(last, Regular, 6, (barWidth / 2) - 4), barX + barWidth, barY - 8, Regular, 6, Palette.Muted, PdfTextAlign.Right);
                }
            }

            if (question.Average is { } mean)
            {
                if (question.IsBandedScale)
                {
                    var band = model.Bands.Of(mean);
                    var text = copy.Score(mean, model.Scale);
                    doc.DrawString(text, Right, top - 15.5, Bold, 9.5, Palette.InkOf(band), PdfTextAlign.Right);
                    Glyph(Right - PdfStandardFontMetrics.MeasureText(text, Bold, 9.5) - 6, top - 12.5, band, 2.6);
                }
                else
                {
                    doc.DrawString(Localised(Math.Round(mean, 2).ToString("0.00", CultureInfo.InvariantCulture)), Right, top - 15.5, Bold, 9.5, Palette.Ink, PdfTextAlign.Right);
                }
            }

            doc.DrawString(string.Format(CultureInfo.InvariantCulture, copy.AnsweredBy, copy.Count(question.AnsweredCount)), Right, top - 25, Regular, 6, Palette.Muted, PdfTextAlign.Right);
            doc.Spacer(height);
        }

        private List<(double Value, SurveyDistributionBucket Bucket)> OrderedBuckets(SurveyReportQuestion question)
            => [.. question.Distribution
                .Select(b => (Ok: double.TryParse(b.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var v), Value: v, Bucket: b))
                .Where(t => t.Ok)
                .OrderBy(t => t.Value)
                .Select(t => (t.Value, t.Bucket))];

        private void StackedBar(SurveyReportQuestion question, double x, double y, double width, double height)
        {
            var buckets = OrderedBuckets(question);
            var total = buckets.Sum(b => b.Bucket.Percentage);
            doc.FillRectangle(x, y, width, height, Palette.Track, 2);
            if (total <= 0)
            {
                return;
            }

            var min = question.ScaleMin ?? (int)buckets[0].Value;
            var max = question.ScaleMax ?? (int)buckets[^1].Value;
            var cursor = x;
            foreach (var (value, bucket) in buckets)
            {
                var segment = width * bucket.Percentage / total;
                if (segment <= 0)
                {
                    continue;
                }

                var position = max > min ? (value - min) / (max - min) : 0.5;
                var (fill, text) = Palette.Distribution[(int)Math.Round(Math.Clamp(position, 0, 1) * 4)];
                doc.FillRectangle(cursor, y, segment, height, fill);
                if (bucket.Percentage >= 9)
                {
                    var label = $"{Math.Round(bucket.Percentage).ToString("0", CultureInfo.InvariantCulture)} %";
                    if (PdfStandardFontMetrics.MeasureText(label, Bold, 6) <= segment - 2)
                    {
                        doc.DrawString(label, cursor + (segment / 2), y + 3.4, Bold, 6, text, PdfTextAlign.Center);
                    }
                }

                cursor += segment;
            }
        }

        private void ChoiceQuestion(SurveyReportQuestion question, double textWidth)
        {
            var lines = PdfDocument.WrapText($"{question.Code} {question.Text}", Regular, 8, Width - 70);
            var options = question.Distribution;
            var height = (lines.Count * 9.5) + 8 + (options.Count * 11) + 4;
            var top = doc.Reserve(Math.Min(height, 200));
            doc.StrokeLine(Left, top, Right, top, Palette.Separator, 0.5);
            for (var i = 0; i < lines.Count; i++)
            {
                doc.DrawString(lines[i], Left, top - 10 - (i * 9.5), i == 0 ? Bold : Regular, 8, Palette.Ink);
            }

            doc.DrawString(string.Format(CultureInfo.InvariantCulture, copy.AnsweredBy, copy.Count(question.AnsweredCount)), Right, top - 10, Regular, 6, Palette.Muted, PdfTextAlign.Right);
            doc.Spacer((lines.Count * 9.5) + 6);

            const double labelWidth = 170;
            var barLeft = Left + labelWidth + 8;
            var barWidth = Width - labelWidth - 60;
            foreach (var option in options)
            {
                var rowTop = doc.Reserve(11);
                doc.DrawString(PdfDocument.Fit(option.Label ?? option.Value, Regular, 7.5, labelWidth), Left + 8, rowTop - 8, Regular, 7.5, Palette.Ink);
                doc.FillRectangle(barLeft, rowTop - 8, barWidth, 5, Palette.Track, 2.5);
                doc.FillRectangle(barLeft, rowTop - 8, barWidth * Math.Clamp(option.Percentage / 100d, 0, 1), 5, Palette.WordBar, 2.5);
                var right = option.AverageRank is { } rank
                    ? string.Format(CultureInfo.InvariantCulture, copy.AverageRank, Localised(Math.Round(rank, 1).ToString("0.0", CultureInfo.InvariantCulture)))
                    : copy.Percent(option.Percentage);
                doc.DrawString(right, Right, rowTop - 8, Regular, 7.5, Palette.Muted, PdfTextAlign.Right);
                doc.Spacer(11);
            }

            doc.Spacer(4);
        }

        // ------------------------------------------------------------------
        // Highlights
        // ------------------------------------------------------------------

        public void Highlights()
        {
            var scale = model.Questions.Where(q => q.IsBandedScale && q.AnsweredCount > 0).ToList();
            if (scale.Count == 0)
            {
                return;
            }

            doc.SectionTitle(copy.HighlightsTitle, copy.HighlightsSubtitle, 80);
            var high = scale.OrderByDescending(q => q.Average).ThenBy(q => q.Code, StringComparer.Ordinal).Take(5).ToList();
            var low = scale.OrderBy(q => q.Average).ThenBy(q => q.Code, StringComparer.Ordinal).Take(5).ToList();
            HighlightList(copy.TopFive, high);
            doc.Spacer(6);
            HighlightList(copy.BottomFive, low);
        }

        private void HighlightList(string title, IReadOnlyList<SurveyReportQuestion> questions)
        {
            KeepTogether(16 + questions.Sum(q => (PdfDocument.WrapText($"{q.Code} {q.Text}", Regular, 8.5, Width - 120).Count * 10.5) + 6));
            var headTop = doc.Reserve(40);
            doc.DrawString(title, Left, headTop - 11, Bold, 9, Palette.Ink);
            doc.Spacer(16);
            foreach (var q in questions)
            {
                var lines = PdfDocument.WrapText($"{q.Code} {q.Text}", Regular, 8.5, Width - 120);
                var height = (lines.Count * 10.5) + 6;
                var top = doc.Reserve(height);
                var band = model.Bands.Of(q.Average!.Value);
                Glyph(Left + 3, top - 6.5, band, 2.8);
                doc.DrawString(copy.Score(q.Average.Value, model.Scale), Left + 10, top - 9, Bold, 9, Palette.InkOf(band));
                for (var i = 0; i < lines.Count; i++)
                {
                    doc.DrawString(lines[i], Left + 46, top - 9 - (i * 10.5), Regular, 8.5, Palette.Ink);
                }

                doc.DrawString(PdfDocument.Fit(q.DimensionName ?? string.Empty, Regular, 7, 64), Right, top - 9, Regular, 7, Palette.Muted, PdfTextAlign.Right);
                doc.Spacer(height);
            }
        }

        // ------------------------------------------------------------------
        // Comparison
        // ------------------------------------------------------------------

        public void Comparison()
        {
            var comparison = model.Comparison!;
            KeepTogether(70 + (comparison.Dimensions.Count * 18) + 40);
            doc.SectionTitle(
                string.Format(CultureInfo.InvariantCulture, copy.ComparisonTitle, comparison.Title ?? copy.UntitledSurvey),
                copy.ComparisonSubtitle,
                60);

            if (comparison.IsSuppressed)
            {
                doc.Paragraph(copy.ComparisonSuppressed, Regular, 9, Palette.Muted);
                return;
            }

            if (comparison.Dimensions.Count == 0)
            {
                doc.Paragraph(copy.ComparisonNoMatch, Regular, 9, Palette.Muted);
                return;
            }

            const double labelWidth = 150;
            const double valueWidth = 120;
            const double rowHeight = 18;
            var trackLeft = Left + labelWidth + 10;
            var trackWidth = Width - labelWidth - valueWidth - 20;
            var center = trackLeft + (trackWidth / 2);
            var extent = Math.Max(0.25, comparison.Dimensions.Max(d => Math.Abs(d.Now - d.Before)));

            foreach (var row in comparison.Dimensions)
            {
                var top = doc.Reserve(rowHeight);
                var delta = row.Now - row.Before;
                doc.DrawString(PdfDocument.Fit(row.Name, Regular, 8, labelWidth), Left, top - 11.5, Regular, 8, Palette.Ink);
                var length = (trackWidth / 2) * Math.Abs(delta) / extent;
                if (delta >= 0)
                {
                    doc.FillRectangle(center, top - 14, length, 8, Palette.Accent, 1.5);
                }
                else
                {
                    doc.FillRectangle(center - length, top - 14, length, 8, Palette.Muted, 1.5);
                }

                doc.StrokeLine(center, top - 2, center, top - rowHeight + 1, Palette.Ink, 0.7);
                var deltaText = copy.Delta(delta, model.Scale);
                var trail = string.Format(CultureInfo.InvariantCulture, copy.BeforeToNow, copy.Score(row.Before, model.Scale), copy.Score(row.Now, model.Scale));
                doc.DrawString(trail, Right, top - 11.5, Regular, 7.5, Palette.Muted, PdfTextAlign.Right);
                doc.DrawString(deltaText, Right - PdfStandardFontMetrics.MeasureText(trail, Regular, 7.5) - 6, top - 11.5, Bold, 8, Palette.Ink, PdfTextAlign.Right);
                doc.Spacer(rowHeight);
            }

            var axisTop = doc.Reserve(16);
            doc.DrawString(copy.Delta(-extent, model.Scale), trackLeft, axisTop - 9, Regular, 7, Palette.Muted);
            doc.DrawString("0", center, axisTop - 9, Regular, 7, Palette.Muted, PdfTextAlign.Center);
            doc.DrawString(copy.Delta(extent, model.Scale), trackLeft + trackWidth, axisTop - 9, Regular, 7, Palette.Muted, PdfTextAlign.Right);
            doc.Spacer(16);

            if (comparison.UnmatchedDimensionCount > 0)
            {
                doc.Paragraph(string.Format(CultureInfo.InvariantCulture, copy.ComparisonUnmatched, copy.Count(comparison.UnmatchedDimensionCount)), Regular, 7.5, Palette.Muted);
            }
        }

        // ------------------------------------------------------------------
        // Comments
        // ------------------------------------------------------------------

        public void Comments()
        {
            var first = model.OpenQuestions.FirstOrDefault();
            KeepTogether(70 + (first is null ? 20 : 40 + (Math.Min(12, first.Words.Count) * 12)));
            doc.SectionTitle(copy.CommentsTitle, copy.CommentsSubtitle, 60);
            if (model.OpenQuestions.Count == 0)
            {
                doc.Paragraph(copy.NoOpenQuestions, Regular, 9, Palette.Muted);
                return;
            }

            foreach (var question in model.OpenQuestions)
            {
                var lines = PdfDocument.WrapText($"{question.Code} {question.Text}", Bold, 8.5, Width);
                KeepTogether((lines.Count * 10.5) + 24 + (Math.Min(12, question.Words.Count) * 12));
                var top = doc.Reserve((lines.Count * 10.5) + 40);
                for (var i = 0; i < lines.Count; i++)
                {
                    doc.DrawString(lines[i], Left, top - 10 - (i * 10.5), Bold, 8.5, Palette.Ink);
                }

                doc.Spacer((lines.Count * 10.5) + 3);
                doc.Paragraph(string.Format(CultureInfo.InvariantCulture, copy.CommentsPeopleWrote, copy.Count(question.AnsweredCount)), Regular, 7.5, Palette.Muted);

                var languages = question.Words.Select(w => w.Language).Distinct(StringComparer.Ordinal).Count();
                var words = question.Words
                    .OrderByDescending(w => w.ResponseCount)
                    .ThenByDescending(w => w.Count)
                    .ThenBy(w => w.Word, StringComparer.Ordinal)
                    .Take(12)
                    .ToList();
                if (words.Count == 0)
                {
                    doc.Paragraph(copy.CommentsNoWords, Regular, 8, Palette.Muted);
                }
                else
                {
                    var most = words.Max(w => w.ResponseCount);
                    const double labelWidth = 130;
                    var barWidth = Width - labelWidth - 50;
                    foreach (var word in words)
                    {
                        var rowTop = doc.Reserve(12);
                        var label = languages > 1 ? $"{word.Word} ({word.Language})" : word.Word;
                        doc.DrawString(PdfDocument.Fit(label, Regular, 8, labelWidth - 6), Left, rowTop - 9, Regular, 8, Palette.Ink);
                        doc.FillRectangle(Left + labelWidth, rowTop - 9, barWidth * word.ResponseCount / Math.Max(1, most), 6, Palette.WordBar, 1.5);
                        doc.DrawString(copy.Count(word.ResponseCount), Right, rowTop - 9, Regular, 8, Palette.Muted, PdfTextAlign.Right);
                        doc.Spacer(12);
                    }
                }

                if (question.SuppressedWordCount > 0)
                {
                    doc.Paragraph(string.Format(CultureInfo.InvariantCulture, copy.CommentsSuppressedWords, copy.Count(question.SuppressedWordCount)), Regular, 7, Palette.Muted);
                }

                doc.Spacer(8);
            }

            doc.Paragraph(copy.CommentsNeverText, Regular, 7.5, Palette.Muted);
        }

        // ------------------------------------------------------------------
        // Small parts
        // ------------------------------------------------------------------

        /// <summary>The area's shape: a triangle up, a dot, a triangle down.</summary>
        private void Glyph(double centerX, double centerY, SurveyReportBand band, double size)
        {
            var ink = Palette.InkOf(band);
            switch (band)
            {
                case SurveyReportBand.Strength:
                    doc.FillPolygon([(centerX - size, centerY - (size * 0.85)), (centerX + size, centerY - (size * 0.85)), (centerX, centerY + size)], ink);
                    break;
                case SurveyReportBand.Opportunity:
                    doc.FillCircle(centerX, centerY, size * 0.85, ink);
                    break;
                default:
                    doc.FillPolygon([(centerX - size, centerY + (size * 0.85)), (centerX + size, centerY + (size * 0.85)), (centerX, centerY - size)], ink);
                    break;
            }
        }

        private double ChipWidth(SurveyReportBand band)
            => PdfStandardFontMetrics.MeasureText(model.Bands.NameOf(band), Bold, 6.5) + 17;

        /// <summary>A rounded pill with the area's glyph and name.</summary>
        private void Chip(double x, double baselineY, SurveyReportBand band)
        {
            var width = ChipWidth(band);
            doc.FillRectangle(x, baselineY - 3, width, 11, Palette.FillOf(band), 5.5);
            Glyph(x + 6.5, baselineY + 2.5, band, 2.4);
            doc.DrawString(model.Bands.NameOf(band), x + 12, baselineY, Bold, 6.5, Palette.InkOf(band));
        }

        private void NewPageUnlessFresh()
        {
            if (doc.CursorY < PageTop - 1)
            {
                doc.StartPage();
            }
        }

        /// <summary>
        /// Starts a new page when a block that would fit on one page does not fit in what is
        /// left of this one -- so a short chart is never split across a page break, and a long
        /// one (a map of sixty departments) simply flows, repeating its header.
        /// </summary>
        private void KeepTogether(double height)
        {
            if (height <= PageTop - 56 && doc.CursorY - height < 56)
            {
                doc.StartPage();
            }
        }

        /// <summary>Wraps a header into at most <paramref name="maxLines"/> lines without breaking a word, shrinking the face down to 5pt before it would.</summary>
        private static (IReadOnlyList<string> Lines, double Size) HeaderLines(string text, double size, double width, int maxLines)
        {
            for (var candidate = size; candidate >= 5; candidate -= 0.5)
            {
                var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (words.All(w => PdfStandardFontMetrics.MeasureText(w, Bold, candidate) <= width))
                {
                    var lines = PdfDocument.WrapText(text, Bold, candidate, width);
                    if (lines.Count <= maxLines)
                    {
                        return (lines, candidate);
                    }
                }
            }

            // A word wider than the column even at 5pt is shortened with an ellipsis, never cut
            // in two: "Reconocimi-ento" across two lines reads as two words.
            var shortened = string.Join(' ', text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(w => PdfDocument.Fit(w, Bold, 5, width)));
            var fallback = PdfDocument.WrapText(shortened, Bold, 5, width).Take(maxLines).ToList();
            return (fallback.Select(l => PdfDocument.Fit(l, Bold, 5, width)).ToList(), 5);
        }

        private string Localised(string invariant) => copy.Spanish ? invariant.Replace('.', ',') : invariant;
    }
}
