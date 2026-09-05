using ClimateProject.Application.Localization;
using ClimateProject.Application.Reports.Rendering;

namespace ClimateProject.Application.Dashboard.Rendering;

/// <summary>
/// Every user-visible string a dashboard export prints, in both content locales (#134).
///
/// ## Why this wraps <see cref="ReportRenderCopy"/> instead of duplicating it
///
/// A dashboard export and a report are two renderings of the same product's numbers, so the
/// words that describe a *number* -- "Withheld", "Not available", "Respondents", "Generated" --
/// have to be the same words in both, or the same suppressed department reads two different
/// ways depending on which button an administrator pressed. <see cref="Shared"/> is that
/// vocabulary, already translated, already carrying the value formatters
/// (<see cref="ReportRenderCopy.Count(int)"/>, <see cref="ReportRenderCopy.Decimal"/>,
/// <see cref="ReportRenderCopy.Day"/>) and the decimal-comma rule.
///
/// What is *not* shared is anything naming a dashboard concept a report has no word for --
/// action plans, member counts, the platform overview. Those live here, so that adding a
/// dashboard label never edits a file the report renderer owns and never has to be reviewed
/// as a change to reports.
/// </summary>
/// <param name="Shared">
/// The report vocabulary and its formatters, resolved for the same locale. Reach through this
/// for anything that describes a number rather than a dashboard.
/// </param>
internal sealed record DashboardExportCopy(
    ReportRenderCopy Shared,
    string CompanyDashboardTitle,
    string DepartmentDashboardTitle,
    string People,
    string Users,
    string ActiveUsers,
    string Members,
    string ActiveMembers,
    string SurveysSection,
    string ActiveSurveys,
    string DraftSurveys,
    string TotalSurveys,
    string ActionPlans,
    string OpenActionPlans,
    string OverdueActionPlans,
    string CompletedResponses,
    string TotalResponses,
    string Company,
    string Departments,
    string Survey,
    string OngoingSurveys,
    string NoOngoingSurveys,
    string NoDepartments,
    string TeamClimate,
    string NoClosedSurvey,
    string ClimateWithheldNotice,
    string MinimumGroupSize,
    string SourceSurvey,
    string ClosedOn,
    string StartDate,
    string EndDate)
{
    private static readonly Dictionary<string, DashboardExportCopy> ByLocale = new(StringComparer.Ordinal)
    {
        [ContentLanguages.English] = new DashboardExportCopy(
            Shared: ReportRenderCopy.For(ContentLanguages.English),
            CompanyDashboardTitle: "Company dashboard",
            DepartmentDashboardTitle: "Department dashboard",
            People: "People",
            Users: "Users",
            ActiveUsers: "Active users",
            Members: "Members",
            ActiveMembers: "Active members",
            SurveysSection: "Surveys",
            ActiveSurveys: "Active surveys",
            DraftSurveys: "Draft surveys",
            TotalSurveys: "Total surveys",
            ActionPlans: "Action plans",
            OpenActionPlans: "Open action plans",
            OverdueActionPlans: "Overdue action plans",
            CompletedResponses: "Completed responses",
            TotalResponses: "Total responses",
            Company: "Company",
            Departments: "Departments",
            Survey: "Survey",
            OngoingSurveys: "Ongoing surveys",
            NoOngoingSurveys: "No survey is currently running.",
            NoDepartments: "No department has been created yet.",
            TeamClimate: "Team climate",
            NoClosedSurvey: "No survey has closed yet, so there is no climate reading to report.",
            ClimateWithheldNotice:
                "This team is below the anonymity floor, so no dimension score is reported. "
                + "That is not a score of zero: with this few respondents a score would amount "
                + "to reading what each person answered.",
            MinimumGroupSize: "Minimum group size",
            SourceSurvey: "Source survey",
            ClosedOn: "Closed on",
            StartDate: "Start date",
            EndDate: "End date"),

        [ContentLanguages.Spanish] = new DashboardExportCopy(
            Shared: ReportRenderCopy.For(ContentLanguages.Spanish),
            CompanyDashboardTitle: "Panel de la empresa",
            DepartmentDashboardTitle: "Panel del departamento",
            People: "Personas",
            Users: "Usuarios",
            ActiveUsers: "Usuarios activos",
            Members: "Integrantes",
            ActiveMembers: "Integrantes activos",
            SurveysSection: "Encuestas",
            ActiveSurveys: "Encuestas activas",
            DraftSurveys: "Encuestas en borrador",
            TotalSurveys: "Total de encuestas",
            ActionPlans: "Planes de acción",
            OpenActionPlans: "Planes de acción abiertos",
            OverdueActionPlans: "Planes de acción vencidos",
            CompletedResponses: "Respuestas completas",
            TotalResponses: "Total de respuestas",
            Company: "Empresa",
            Departments: "Departamentos",
            Survey: "Encuesta",
            OngoingSurveys: "Encuestas en curso",
            NoOngoingSurveys: "No hay ninguna encuesta en curso.",
            NoDepartments: "Todavía no se ha creado ningún departamento.",
            TeamClimate: "Clima del equipo",
            NoClosedSurvey: "Todavía no se ha cerrado ninguna encuesta, así que no hay ninguna lectura de clima que informar.",
            ClimateWithheldNotice:
                "Este equipo está por debajo del umbral de anonimato, así que no se informa "
                + "ninguna puntuación por dimensión. Eso no es una puntuación de cero: con tan "
                + "pocas personas que respondieron, una puntuación equivaldría a leer lo que "
                + "contestó cada una.",
            MinimumGroupSize: "Tamaño mínimo del grupo",
            SourceSurvey: "Encuesta de origen",
            ClosedOn: "Cerrada el",
            StartDate: "Fecha de inicio",
            EndDate: "Fecha de cierre"),
    };

    /// <summary>
    /// The copy for a requested locale, falling back exactly as
    /// <see cref="ReportRenderCopy.For"/> does, so an export and a report never disagree about
    /// which language an unrecognised <c>?lang=</c> resolves to.
    /// </summary>
    public static DashboardExportCopy For(string? locale)
    {
        var normalised = ContentLanguages.NormaliseLocale(locale) ?? ContentLanguages.FallbackLocale;
        return ByLocale.TryGetValue(normalised, out var copy) ? copy : ByLocale[ContentLanguages.FallbackLocale];
    }
}
