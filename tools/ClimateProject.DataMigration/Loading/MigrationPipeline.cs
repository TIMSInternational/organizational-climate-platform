using ClimateProject.DataMigration.Legacy;
using ClimateProject.DataMigration.Mapping;
using ClimateProject.DataMigration.Reporting;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;

namespace ClimateProject.DataMigration.Loading;

public sealed record CollectionResult(string Collection, long SourceCount, int Written, int Skipped);

public sealed record MigrationResult(IReadOnlyList<CollectionResult> Collections)
{
    /// <summary>
    /// Reconciliation layer 1 (sub-issue E): source documents = rows written + skips,
    /// with the skips accounted by name in the report. A count that reconciles only
    /// because a skip went uncounted is the named trap - so this throws.
    /// </summary>
    public void AssertReconciled()
    {
        foreach (var result in Collections)
        {
            if (result.SourceCount != result.Written + result.Skipped)
            {
                throw new InvalidOperationException(
                    $"{result.Collection} does not reconcile: {result.SourceCount} source documents, "
                    + $"{result.Written} written + {result.Skipped} skipped = {result.Written + result.Skipped}.");
            }
        }
    }
}

/// <summary>
/// The mapped load: Company -> DemographicField -> Department -> User ->
/// SystemSettings -> Survey (with its Question/option/logic/target fan-out) ->
/// SurveyTemplate (question/option fan-out) -> Response (answers + demographics, the
/// volume driver), in FK order, then the
/// second pass for the three self- and cross-referential columns
/// (department parent, department manager, user manager) that cannot be satisfied on
/// first insert. Reference targets are the ids present in the TARGET database plus
/// this run's own writes, so a filtered or resumed run resolves against what earlier
/// runs already loaded.
///
/// Writes are fetch-then-update upserts on the deterministic id: last run wins for
/// every mapped column, and columns the app initialises itself (User.SecurityStamp)
/// are never copied - a re-keyed stamp ends live sessions (sub-issue D).
/// </summary>
public sealed class MigrationPipeline(
    IMongoDatabase mongo,
    ClimateProjectDbContext db,
    DataQualityReport report,
    bool dryRun)
{
    public static readonly IReadOnlyList<string> MappedCollections =
    [
        "companies", "demographicfields", "departments", "users", "systemsettings",
        "surveys", "surveytemplates", "surveyversions", "surveyauditlogs",
        "surveydrafts", "surveydistributions", "surveyinvitations", "responses",
        "microclimatetemplates", "microclimates", "microclimateinvitations",
    ];

    private readonly List<CollectionResult> _results = [];
    private readonly List<MappedDepartment> _departmentsThisRun = [];
    private readonly List<MappedUser> _usersThisRun = [];

    public async Task<MigrationResult> RunAsync(IReadOnlyList<string> collections, CancellationToken ct)
    {
        var wanted = collections.Count == 0
            ? MappedCollections
            : collections;

        var unmapped = wanted.Except(MappedCollections, StringComparer.Ordinal).ToList();
        if (unmapped.Count > 0)
        {
            // Fail rather than pretend: a run that silently ignores collections it
            // cannot load reads as "migrated" to whoever launched it.
            throw new NotSupportedException(
                $"No mapping exists yet for: {string.Join(", ", unmapped)}. Implemented so far: "
                + $"{string.Join(", ", MappedCollections)} (sub-issues #335-#339 track the rest).");
        }

        if (wanted.Contains("companies"))
        {
            await LoadCompaniesAsync(ct);
        }

        var context = await BuildContextAsync(ct);

        if (wanted.Contains("demographicfields"))
        {
            await LoadDemographicFieldsAsync(context, ct);
            context = await BuildContextAsync(ct);
        }

        if (wanted.Contains("departments"))
        {
            await LoadDepartmentsAsync(context, ct);
            context = await BuildContextAsync(ct);
        }

        if (wanted.Contains("users"))
        {
            await LoadUsersAsync(context, ct);
            context = await BuildContextAsync(ct);
        }

        if (wanted.Contains("systemsettings"))
        {
            await LoadSystemSettingsAsync(context, ct);
        }

        if (wanted.Contains("surveys"))
        {
            context = await BuildContextAsync(ct);
            await LoadSurveysAsync(context, ct);
        }

        if (wanted.Contains("surveytemplates"))
        {
            context = await BuildContextAsync(ct);
            await LoadSurveyTemplatesAsync(context, ct);
        }

        if (wanted.Contains("surveyversions"))
        {
            context = await BuildContextAsync(ct);
            await LoadSurveyVersionsAsync(context, ct);
        }

        if (wanted.Contains("surveyauditlogs"))
        {
            context = await BuildContextAsync(ct);
            await LoadSurveyAuditLogsAsync(context, ct);
        }

        if (wanted.Contains("surveydrafts"))
        {
            context = await BuildContextAsync(ct);
            await LoadSurveyDraftsAsync(context, ct);
        }

        if (wanted.Contains("surveydistributions"))
        {
            context = await BuildContextAsync(ct);
            await LoadSurveyDistributionsAsync(context, ct);
        }

        if (wanted.Contains("surveyinvitations"))
        {
            context = await BuildContextAsync(ct);
            await LoadSurveyInvitationsAsync(context, ct);
        }

        if (wanted.Contains("responses"))
        {
            context = await BuildContextAsync(ct);
            await LoadResponsesAsync(context, ct);
        }

        if (wanted.Contains("microclimatetemplates"))
        {
            context = await BuildContextAsync(ct);
            await LoadMicroclimateTemplatesAsync(context, ct);
        }

        if (wanted.Contains("microclimates"))
        {
            context = await BuildContextAsync(ct);
            await LoadMicroclimatesAsync(context, ct);
        }

        if (wanted.Contains("microclimateinvitations"))
        {
            context = await BuildContextAsync(ct);
            await LoadMicroclimateInvitationsAsync(context, ct);
        }

        await SecondPassAsync(context, ct);
        AssertDepartmentHierarchy();

        return new MigrationResult(_results);
    }

    private async Task<MappingContext> BuildContextAsync(CancellationToken ct)
    {
        // Target-side truth plus this run's in-memory writes (which in dry-run never
        // reach the database but must still resolve for later stages).
        var companies = (await db.Companies.Select(c => new { c.Id, c.Settings.Language }).ToListAsync(ct))
            .ToDictionary(c => c.Id, c => c.Language);
        foreach (var entry in db.Companies.Local)
        {
            companies[entry.Id] = entry.Settings.Language;
        }

        var departments = (await db.Departments.Select(d => d.Id).ToListAsync(ct)).ToHashSet();
        departments.UnionWith(db.Departments.Local.Select(d => d.Id));
        departments.UnionWith(_departmentsThisRun.Select(d => d.Department.Id));

        var users = (await db.Users.Select(u => u.Id).ToListAsync(ct)).ToHashSet();
        users.UnionWith(db.Users.Local.Select(u => u.Id));
        users.UnionWith(_usersThisRun.Select(u => u.User.Id));

        var surveyLanguages = (await db.Surveys.Select(s => new { s.Id, s.Language }).ToListAsync(ct))
            .ToDictionary(s => s.Id, s => s.Language);
        foreach (var entry in db.Surveys.Local)
        {
            surveyLanguages[entry.Id] = entry.Language;
        }

        var surveys = surveyLanguages.Keys.ToHashSet();

        var questions = (await db.Questions.Select(q => q.Id).ToListAsync(ct)).ToHashSet();
        questions.UnionWith(db.Questions.Local.Select(q => q.Id));

        var microclimateTemplates = (await db.MicroclimateTemplates.Select(t => t.Id).ToListAsync(ct)).ToHashSet();
        microclimateTemplates.UnionWith(db.MicroclimateTemplates.Local.Select(t => t.Id));

        var microclimates = (await db.Microclimates.Select(m => m.Id).ToListAsync(ct)).ToHashSet();
        microclimates.UnionWith(db.Microclimates.Local.Select(m => m.Id));

        var fields = new Dictionary<(Guid, string), Guid>();
        foreach (var field in await db.DemographicFields.Select(f => new { f.Id, f.CompanyId, f.Field }).ToListAsync(ct))
        {
            fields[(field.CompanyId, field.Field)] = field.Id;
        }

        foreach (var field in db.DemographicFields.Local)
        {
            fields[(field.CompanyId, field.Field)] = field.Id;
        }

        return new MappingContext
        {
            Report = report,
            Companies = companies.Keys.ToHashSet(),
            CompanyLanguages = companies,
            Departments = departments,
            Users = users,
            Surveys = surveys,
            SurveyLanguages = surveyLanguages,
            Questions = questions,
            MicroclimateTemplates = microclimateTemplates,
            Microclimates = microclimates,
            DemographicFields = fields,
        };
    }

    private async Task LoadCompaniesAsync(CancellationToken ct)
    {
        var context = await BuildContextAsync(ct);
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacyCompany>("companies", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (CompanyMapper.Map(document, context) is not { } company)
            {
                continue;
            }

            var existing = await db.Companies.FindAsync([company.Id], ct);
            if (existing is null)
            {
                db.Companies.Add(company);
            }
            else
            {
                existing.Name = company.Name;
                existing.EmailDomain = company.EmailDomain;
                existing.Industry = company.Industry;
                existing.Size = company.Size;
                existing.Country = company.Country;
                existing.SubscriptionTier = company.SubscriptionTier;
                existing.Branding = company.Branding;
                existing.Settings = company.Settings;
                existing.CreatedAt = company.CreatedAt;
            }

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("companies", source, written, report.SkipCount("companies")));
    }

    private async Task LoadDemographicFieldsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacyDemographicField>("demographicfields", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (DemographicFieldMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            var existing = await db.DemographicFields.FindAsync([mapped.Field.Id], ct);
            if (existing is null)
            {
                db.DemographicFields.Add(mapped.Field);
            }
            else
            {
                existing.CompanyId = mapped.Field.CompanyId;
                existing.Field = mapped.Field.Field;
                existing.LabelEn = mapped.Field.LabelEn;
                existing.LabelEs = mapped.Field.LabelEs;
                existing.Type = mapped.Field.Type;
                existing.Required = mapped.Field.Required;
                existing.Order = mapped.Field.Order;
                existing.IsActive = mapped.Field.IsActive;
                existing.CreatedAt = mapped.Field.CreatedAt;
                existing.UpdatedAt = mapped.Field.UpdatedAt;
            }

            // Options are replaced wholesale: their identity is (field, order) and the
            // set converges to the source on every run.
            var stale = await db.DemographicFieldOptions
                .Where(o => o.DemographicFieldId == mapped.Field.Id).ToListAsync(ct);
            db.DemographicFieldOptions.RemoveRange(stale);
            db.DemographicFieldOptions.AddRange(mapped.Options);

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("demographicfields", source, written, report.SkipCount("demographicfields")));
    }

    private async Task LoadDepartmentsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var seenLegacyExternalIds = new HashSet<string>(StringComparer.Ordinal);
        await foreach (var document in Read<LegacyDepartment>("departments", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (DepartmentMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            // legacy_external_id carries a filtered unique index; a collision aborts
            // climate-tracking's cache sync wholesale, so it is refused here by name.
            if (!seenLegacyExternalIds.Add(mapped.Department.LegacyExternalId!))
            {
                report.Skip(MigrationRules.DuplicateLegacyExternalId, "departments",
                    document.Id.ToString(),
                    "another department already carries this legacy _id; the unique index would refuse it");
                continue;
            }

            var existing = await db.Departments.FindAsync([mapped.Department.Id], ct);
            if (existing is null)
            {
                db.Departments.Add(mapped.Department);
            }
            else
            {
                existing.LegacyExternalId = mapped.Department.LegacyExternalId;
                existing.CompanyId = mapped.Department.CompanyId;
                existing.Name = mapped.Department.Name;
                existing.Description = mapped.Department.Description;
                existing.EmployeeCount = mapped.Department.EmployeeCount;
                existing.IsActive = mapped.Department.IsActive;
                existing.Settings = mapped.Department.Settings;
                existing.CreatedAt = mapped.Department.CreatedAt;
                existing.UpdatedAt = mapped.Department.UpdatedAt;
            }

            _departmentsThisRun.Add(mapped);
            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("departments", source, written, report.SkipCount("departments")));
    }

    private async Task LoadUsersAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var seenEmails = new HashSet<string>(StringComparer.Ordinal);
        await foreach (var document in Read<LegacyUser>("users", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (UserMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            // users.email is unique; the second document with an email is the anomaly
            // (ascending-_id order makes "first" deterministic across runs).
            if (!seenEmails.Add(mapped.User.Email))
            {
                report.Skip(MigrationRules.DuplicateEmail, "users", document.Id.ToString(),
                    $"another user already carries '{mapped.User.Email}'; the unique index would refuse it",
                    field: null);
                continue;
            }

            var existing = await db.Users.FindAsync([mapped.User.Id], ct);
            if (existing is null)
            {
                // SecurityStamp: the entity's own initializer mints one on insert; the
                // mapper never set it, and the update branch never copies it (#284).
                db.Users.Add(mapped.User);
            }
            else
            {
                existing.CompanyId = mapped.User.CompanyId;
                existing.Email = mapped.User.Email;
                existing.Name = mapped.User.Name;
                existing.PasswordHash = mapped.User.PasswordHash;
                existing.Role = mapped.User.Role;
                existing.PersonaExternalId = mapped.User.PersonaExternalId;
                existing.DepartmentId = mapped.User.DepartmentId;
                existing.IsActive = mapped.User.IsActive;
                existing.LastLoginAt = mapped.User.LastLoginAt;
                existing.ConsentUpdatedAt = mapped.User.ConsentUpdatedAt;
                existing.Preferences = mapped.User.Preferences;
                existing.Notifications = mapped.User.Notifications;
                existing.Consent = mapped.User.Consent;
                existing.CreatedAt = mapped.User.CreatedAt;
                existing.UpdatedAt = mapped.User.UpdatedAt;
            }

            var staleDemographics = await db.UserDemographics
                .Where(d => d.UserId == mapped.User.Id).ToListAsync(ct);
            db.UserDemographics.RemoveRange(staleDemographics);
            db.UserDemographics.AddRange(mapped.Demographics);

            _usersThisRun.Add(mapped);
            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("users", source, written, report.SkipCount("users")));
    }

    private async Task LoadSystemSettingsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacySystemSettings>("systemsettings", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            var mapped = SystemSettingsMapper.Map(document, context);

            var existing = await db.SystemSettings.FindAsync([mapped.Id], ct);
            if (existing is null)
            {
                db.SystemSettings.Add(mapped);
            }
            else
            {
                existing.LoginEnabled = mapped.LoginEnabled;
                existing.MaintenanceMode = mapped.MaintenanceMode;
                existing.MaintenanceMessageEn = mapped.MaintenanceMessageEn;
                existing.MaintenanceMessageEs = mapped.MaintenanceMessageEs;
                existing.MaxLoginAttempts = mapped.MaxLoginAttempts;
                existing.SessionTimeoutMinutes = mapped.SessionTimeoutMinutes;
                existing.PasswordPolicy = mapped.PasswordPolicy;
                existing.EmailSettings = mapped.EmailSettings;
                existing.CreatedAt = mapped.CreatedAt;
                existing.UpdatedAt = mapped.UpdatedAt;
            }

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("systemsettings", source, written, report.SkipCount("systemsettings")));
    }

    private async Task LoadSurveysAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacySurvey>("surveys", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (SurveyMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            var existing = await db.Surveys.FindAsync([mapped.Survey.Id], ct);
            if (existing is null)
            {
                db.Surveys.Add(mapped.Survey);
            }
            else
            {
                existing.CompanyId = mapped.Survey.CompanyId;
                existing.CreatedBy = mapped.Survey.CreatedBy;
                existing.TitleEn = mapped.Survey.TitleEn;
                existing.TitleEs = mapped.Survey.TitleEs;
                existing.DescriptionEn = mapped.Survey.DescriptionEn;
                existing.DescriptionEs = mapped.Survey.DescriptionEs;
                existing.Language = mapped.Survey.Language;
                existing.Type = mapped.Survey.Type;
                existing.StartDate = mapped.Survey.StartDate;
                existing.EndDate = mapped.Survey.EndDate;
                existing.Status = mapped.Survey.Status;
                existing.ResponseCount = mapped.Survey.ResponseCount;
                existing.TargetAudienceCount = mapped.Survey.TargetAudienceCount;
                existing.Version = mapped.Survey.Version;
                existing.Settings = mapped.Survey.Settings;
                existing.CreatedAt = mapped.Survey.CreatedAt;
                existing.UpdatedAt = mapped.Survey.UpdatedAt;
            }

            // Questions upsert on their deterministic PK; a row whose id vanished from
            // the source array is deleted so re-runs converge (its option/emoji/logic
            // children go with it via the FK cascade). NOTE for the Response slice:
            // once question_responses exist, that delete will trip their FK - stale
            // then has to become a reported refusal instead, decided in that slice.
            var keptIds = mapped.Questions.Select(q => q.Id).ToHashSet();
            var existingQuestions = await db.Questions
                .Where(q => q.SurveyId == mapped.Survey.Id).ToListAsync(ct);
            db.Questions.RemoveRange(existingQuestions.Where(q => !keptIds.Contains(q.Id)));
            var questionsById = existingQuestions.ToDictionary(q => q.Id);
            foreach (var question in mapped.Questions)
            {
                if (questionsById.TryGetValue(question.Id, out var current))
                {
                    current.TextEn = question.TextEn;
                    current.TextEs = question.TextEs;
                    current.Type = question.Type;
                    current.ScaleMin = question.ScaleMin;
                    current.ScaleMax = question.ScaleMax;
                    current.ScaleLabelMinEn = question.ScaleLabelMinEn;
                    current.ScaleLabelMinEs = question.ScaleLabelMinEs;
                    current.ScaleLabelMaxEn = question.ScaleLabelMaxEn;
                    current.ScaleLabelMaxEs = question.ScaleLabelMaxEs;
                    current.CommentRequired = question.CommentRequired;
                    current.CommentPromptEn = question.CommentPromptEn;
                    current.CommentPromptEs = question.CommentPromptEs;
                    current.BinaryCommentConfigEn = question.BinaryCommentConfigEn;
                    current.BinaryCommentConfigEs = question.BinaryCommentConfigEs;
                    current.Required = question.Required;
                    current.Order = question.Order;
                    current.Category = question.Category;
                }
                else
                {
                    db.Questions.Add(question);
                }
            }

            // Option rows are replaced wholesale: identity is (question, order/value)
            // and the set converges to the source on every run - the
            // DemographicFieldOption precedent.
            var staleOptions = await db.QuestionOptions
                .Where(o => keptIds.Contains(o.QuestionId)).ToListAsync(ct);
            db.QuestionOptions.RemoveRange(staleOptions);
            db.QuestionOptions.AddRange(mapped.Options);

            var staleEmoji = await db.QuestionEmojiOptions
                .Where(o => keptIds.Contains(o.QuestionId)).ToListAsync(ct);
            db.QuestionEmojiOptions.RemoveRange(staleEmoji);
            db.QuestionEmojiOptions.AddRange(mapped.EmojiOptions);

            // Conditional logic is 1:1 on the question id, so it upserts in place -
            // a delete-and-re-add would put a delete and an insert of the same PK in
            // one SaveChanges for no benefit.
            var existingLogic = await db.QuestionConditionalLogics
                .Where(l => keptIds.Contains(l.QuestionId)).ToListAsync(ct);
            var mappedLogicIds = mapped.ConditionalLogic.Select(l => l.QuestionId).ToHashSet();
            db.QuestionConditionalLogics.RemoveRange(existingLogic.Where(l => !mappedLogicIds.Contains(l.QuestionId)));
            var logicById = existingLogic.ToDictionary(l => l.QuestionId);
            foreach (var logic in mapped.ConditionalLogic)
            {
                if (logicById.TryGetValue(logic.QuestionId, out var current))
                {
                    current.ConditionQuestionId = logic.ConditionQuestionId;
                    current.ConditionOperator = logic.ConditionOperator;
                    current.ConditionValue = logic.ConditionValue;
                    current.Action = logic.Action;
                    current.TargetQuestionId = logic.TargetQuestionId;
                }
                else
                {
                    db.QuestionConditionalLogics.Add(logic);
                }
            }

            var staleTargets = await db.SurveyDepartmentTargets
                .Where(t => t.SurveyId == mapped.Survey.Id).ToListAsync(ct);
            db.SurveyDepartmentTargets.RemoveRange(staleTargets);
            db.SurveyDepartmentTargets.AddRange(mapped.DepartmentTargets);

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("surveys", source, written, report.SkipCount("surveys")));
    }

    private async Task LoadSurveyTemplatesAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacySurveyTemplate>("surveytemplates", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (SurveyTemplateMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            var existing = await db.SurveyTemplates.FindAsync([mapped.Template.Id], ct);
            if (existing is null)
            {
                db.SurveyTemplates.Add(mapped.Template);
            }
            else
            {
                existing.Name = mapped.Template.Name;
                existing.Description = mapped.Template.Description;
                existing.Category = mapped.Template.Category;
                existing.Industry = mapped.Template.Industry;
                existing.CompanySize = mapped.Template.CompanySize;
                existing.IsPublic = mapped.Template.IsPublic;
                existing.CreatedBy = mapped.Template.CreatedBy;
                existing.CompanyId = mapped.Template.CompanyId;
                existing.UsageCount = mapped.Template.UsageCount;
                existing.Rating = mapped.Template.Rating;
                existing.Tags = mapped.Template.Tags;
                existing.SourceSurveyId = mapped.Template.SourceSurveyId;
                existing.LastUsed = mapped.Template.LastUsed;
                existing.CreatedAt = mapped.Template.CreatedAt;
                existing.UpdatedAt = mapped.Template.UpdatedAt;
            }

            // Question upsert-plus-stale-sweep, the surveys-stage shape - simpler here
            // because nothing else holds an FK to a template question (instantiation
            // copies values, it never links back), so the sweep stays safe forever.
            var keptIds = mapped.Questions.Select(q => q.Id).ToHashSet();
            var existingQuestions = await db.TemplateQuestions
                .Where(q => q.TemplateId == mapped.Template.Id).ToListAsync(ct);
            db.TemplateQuestions.RemoveRange(existingQuestions.Where(q => !keptIds.Contains(q.Id)));
            var questionsById = existingQuestions.ToDictionary(q => q.Id);
            foreach (var question in mapped.Questions)
            {
                if (questionsById.TryGetValue(question.Id, out var current))
                {
                    current.TextEn = question.TextEn;
                    current.TextEs = question.TextEs;
                    current.Type = question.Type;
                    current.ScaleMin = question.ScaleMin;
                    current.ScaleMax = question.ScaleMax;
                    current.ScaleLabelMinEn = question.ScaleLabelMinEn;
                    current.ScaleLabelMinEs = question.ScaleLabelMinEs;
                    current.ScaleLabelMaxEn = question.ScaleLabelMaxEn;
                    current.ScaleLabelMaxEs = question.ScaleLabelMaxEs;
                    current.CommentRequired = question.CommentRequired;
                    current.CommentPromptEn = question.CommentPromptEn;
                    current.CommentPromptEs = question.CommentPromptEs;
                    current.BinaryCommentConfigEn = question.BinaryCommentConfigEn;
                    current.BinaryCommentConfigEs = question.BinaryCommentConfigEs;
                    current.Required = question.Required;
                    current.Order = question.Order;
                    current.Category = question.Category;
                }
                else
                {
                    db.TemplateQuestions.Add(question);
                }
            }

            var staleOptions = await db.TemplateQuestionOptions
                .Where(o => keptIds.Contains(o.TemplateQuestionId)).ToListAsync(ct);
            db.TemplateQuestionOptions.RemoveRange(staleOptions);
            db.TemplateQuestionOptions.AddRange(mapped.Options);

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("surveytemplates", source, written, report.SkipCount("surveytemplates")));
    }

    private async Task LoadMicroclimateTemplatesAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacyMicroclimateTemplate>("microclimatetemplates", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (MicroclimateTemplateMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            var existing = await db.MicroclimateTemplates.FindAsync([mapped.Template.Id], ct);
            if (existing is null)
            {
                db.MicroclimateTemplates.Add(mapped.Template);
            }
            else
            {
                existing.Name = mapped.Template.Name;
                existing.Description = mapped.Template.Description;
                existing.Category = mapped.Template.Category;
                existing.CompanyId = mapped.Template.CompanyId;
                existing.CreatedBy = mapped.Template.CreatedBy;
                existing.IsSystemTemplate = mapped.Template.IsSystemTemplate;
                existing.UsageCount = mapped.Template.UsageCount;
                existing.IsActive = mapped.Template.IsActive;
                existing.Tags = mapped.Template.Tags;
                existing.Settings = mapped.Template.Settings;
                existing.CreatedAt = mapped.Template.CreatedAt;
                existing.UpdatedAt = mapped.Template.UpdatedAt;
            }

            var keptIds = mapped.Questions.Select(q => q.Id).ToHashSet();
            var stale = await db.MicroclimateTemplateQuestions
                .Where(q => q.TemplateId == mapped.Template.Id).ToListAsync(ct);
            db.MicroclimateTemplateQuestions.RemoveRange(stale.Where(q => !keptIds.Contains(q.Id)));
            var byId = stale.ToDictionary(q => q.Id);
            foreach (var question in mapped.Questions)
            {
                if (byId.TryGetValue(question.Id, out var current))
                {
                    current.TextEn = question.TextEn;
                    current.TextEs = question.TextEs;
                    current.Type = question.Type;
                    current.Required = question.Required;
                    current.Order = question.Order;
                    current.Category = question.Category;
                }
                else
                {
                    db.MicroclimateTemplateQuestions.Add(question);
                }
            }

            var staleOptions = await db.MicroclimateTemplateQuestionOptions
                .Where(o => keptIds.Contains(o.MicroclimateTemplateQuestionId)).ToListAsync(ct);
            db.MicroclimateTemplateQuestionOptions.RemoveRange(staleOptions);
            db.MicroclimateTemplateQuestionOptions.AddRange(mapped.Options);

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("microclimatetemplates", source, written, report.SkipCount("microclimatetemplates")));
    }

    private async Task LoadMicroclimatesAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacyMicroclimate>("microclimates", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (MicroclimateMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            var existing = await db.Microclimates.FindAsync([mapped.Microclimate.Id], ct);
            if (existing is null)
            {
                db.Microclimates.Add(mapped.Microclimate);
            }
            else
            {
                existing.TitleEn = mapped.Microclimate.TitleEn;
                existing.TitleEs = mapped.Microclimate.TitleEs;
                existing.DescriptionEn = mapped.Microclimate.DescriptionEn;
                existing.DescriptionEs = mapped.Microclimate.DescriptionEs;
                existing.Language = mapped.Microclimate.Language;
                existing.CompanyId = mapped.Microclimate.CompanyId;
                existing.CreatedBy = mapped.Microclimate.CreatedBy;
                existing.TemplateId = mapped.Microclimate.TemplateId;
                existing.Status = mapped.Microclimate.Status;
                existing.ResponseCount = mapped.Microclimate.ResponseCount;
                existing.TargetParticipantCount = mapped.Microclimate.TargetParticipantCount;
                existing.ParticipationRate = mapped.Microclimate.ParticipationRate;
                existing.Targeting = mapped.Microclimate.Targeting;
                existing.Scheduling = mapped.Microclimate.Scheduling;
                existing.RealtimeSettings = mapped.Microclimate.RealtimeSettings;
                existing.LiveResults = mapped.Microclimate.LiveResults;
                existing.CreatedAt = mapped.Microclimate.CreatedAt;
                existing.UpdatedAt = mapped.Microclimate.UpdatedAt;
            }

            var keptIds = mapped.Questions.Select(q => q.Id).ToHashSet();
            var staleQuestions = await db.MicroclimateQuestions
                .Where(q => q.MicroclimateId == mapped.Microclimate.Id).ToListAsync(ct);
            db.MicroclimateQuestions.RemoveRange(staleQuestions.Where(q => !keptIds.Contains(q.Id)));
            var byId = staleQuestions.ToDictionary(q => q.Id);
            foreach (var question in mapped.Questions)
            {
                if (byId.TryGetValue(question.Id, out var current))
                {
                    current.TextEn = question.TextEn;
                    current.TextEs = question.TextEs;
                    current.Type = question.Type;
                    current.Required = question.Required;
                    current.Order = question.Order;
                }
                else
                {
                    db.MicroclimateQuestions.Add(question);
                }
            }

            var staleOptions = await db.MicroclimateQuestionOptions
                .Where(o => keptIds.Contains(o.MicroclimateQuestionId)).ToListAsync(ct);
            db.MicroclimateQuestionOptions.RemoveRange(staleOptions);
            db.MicroclimateQuestionOptions.AddRange(mapped.Options);

            var staleTargets = await db.MicroclimateDepartmentTargets
                .Where(t => t.MicroclimateId == mapped.Microclimate.Id).ToListAsync(ct);
            db.MicroclimateDepartmentTargets.RemoveRange(staleTargets);
            db.MicroclimateDepartmentTargets.AddRange(mapped.DepartmentTargets);

            var staleInsights = await db.MicroclimateAiInsights
                .Where(i => i.MicroclimateId == mapped.Microclimate.Id).ToListAsync(ct);
            db.MicroclimateAiInsights.RemoveRange(staleInsights);
            db.MicroclimateAiInsights.AddRange(mapped.Insights);

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("microclimates", source, written, report.SkipCount("microclimates")));
    }

    private async Task LoadMicroclimateInvitationsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var sinceSave = 0;
        var seenTokens = new HashSet<string>(StringComparer.Ordinal);
        await foreach (var document in Read<LegacyMicroclimateInvitation>("microclimateinvitations", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (MicroclimateInvitationMapper.Map(document, context) is not { } invitation)
            {
                continue;
            }

            if (!seenTokens.Add(invitation.InvitationToken))
            {
                report.Skip(MigrationRules.InvitationDuplicateToken, "microclimateinvitations",
                    document.Id.ToString(),
                    "another invitation already carries this token; the unique index would refuse it",
                    "invitation_token");
                continue;
            }

            var existing = await db.MicroclimateInvitations.FindAsync([invitation.Id], ct);
            if (existing is null)
            {
                db.MicroclimateInvitations.Add(invitation);
            }
            else
            {
                existing.MicroclimateId = invitation.MicroclimateId;
                existing.UserId = invitation.UserId;
                existing.CompanyId = invitation.CompanyId;
                existing.Email = invitation.Email;
                existing.InvitationToken = invitation.InvitationToken;
                existing.Status = invitation.Status;
                existing.SentAt = invitation.SentAt;
                existing.OpenedAt = invitation.OpenedAt;
                existing.StartedAt = invitation.StartedAt;
                existing.CompletedAt = invitation.CompletedAt;
                existing.ReminderCount = invitation.ReminderCount;
                existing.LastReminderSent = invitation.LastReminderSent;
                existing.ExpiresAt = invitation.ExpiresAt;
                existing.Metadata = invitation.Metadata;
                existing.CreatedAt = invitation.CreatedAt;
                existing.UpdatedAt = invitation.UpdatedAt;
            }

            written++;
            if (++sinceSave >= 500)
            {
                await SaveAsync(ct);
                db.ChangeTracker.Clear();
                sinceSave = 0;
            }
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("microclimateinvitations", source, written, report.SkipCount("microclimateinvitations")));
    }

    private async Task LoadSurveyDraftsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        await foreach (var document in Read<LegacySurveyDraft>("surveydrafts", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (SurveyDraftMapper.Map(document, context) is not { } draft)
            {
                continue;
            }

            var existing = await db.SurveyDrafts.FindAsync([draft.Id], ct);
            if (existing is null)
            {
                db.SurveyDrafts.Add(draft);
            }
            else
            {
                existing.UserId = draft.UserId;
                existing.CompanyId = draft.CompanyId;
                existing.SessionId = draft.SessionId;
                existing.CurrentStep = draft.CurrentStep;
                existing.LastEditedField = draft.LastEditedField;
                existing.AutoSaveCount = draft.AutoSaveCount;
                existing.Version = draft.Version;
                existing.LastAutosaveAt = draft.LastAutosaveAt;
                existing.ExpiresAt = draft.ExpiresAt;
                existing.IsRecovered = draft.IsRecovered;
                existing.DraftData = draft.DraftData;
                existing.CreatedAt = draft.CreatedAt;
                existing.UpdatedAt = draft.UpdatedAt;
            }

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("surveydrafts", source, written, report.SkipCount("surveydrafts")));
    }

    /// <summary>
    /// survey_id is uniquely indexed on both sides - one distribution per survey - so a
    /// second document for the same survey is refused by name rather than by a
    /// constraint violation that would abort the batch.
    /// </summary>
    private async Task LoadSurveyDistributionsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var seenSurveys = new HashSet<Guid>();
        await foreach (var document in Read<LegacySurveyDistribution>("surveydistributions", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (SurveyDistributionMapper.Map(document, context) is not { } distribution)
            {
                continue;
            }

            if (!seenSurveys.Add(distribution.SurveyId))
            {
                report.Skip(MigrationRules.DistributionDuplicateSurvey, "surveydistributions",
                    document.Id.ToString(),
                    "another distribution already covers this survey; the unique index would refuse it",
                    "survey_id");
                continue;
            }

            var existing = await db.SurveyDistributions.FindAsync([distribution.Id], ct);
            if (existing is null)
            {
                db.SurveyDistributions.Add(distribution);
            }
            else
            {
                existing.SurveyId = distribution.SurveyId;
                existing.AccessType = distribution.AccessType;
                existing.PublicUrl = distribution.PublicUrl;
                existing.QrCodeUrl = distribution.QrCodeUrl;
                existing.QrCodeSvgUrl = distribution.QrCodeSvgUrl;
                existing.QrCodePngUrl = distribution.QrCodePngUrl;
                existing.QrCodePdfUrl = distribution.QrCodePdfUrl;
                existing.TokenizedLinksGenerated = distribution.TokenizedLinksGenerated;
                existing.AccessRules = distribution.AccessRules;
                existing.QrCustomization = distribution.QrCustomization;
                existing.CreatedAt = distribution.CreatedAt;
                existing.UpdatedAt = distribution.UpdatedAt;
            }

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("surveydistributions", source, written, report.SkipCount("surveydistributions")));
    }

    private async Task LoadSurveyInvitationsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var sinceSave = 0;
        var seenTokens = new HashSet<string>(StringComparer.Ordinal);
        await foreach (var document in Read<LegacySurveyInvitation>("surveyinvitations", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (SurveyInvitationMapper.Map(document, context) is not { } invitation)
            {
                continue;
            }

            // invitation_token is uniquely indexed; ascending-_id order makes "first"
            // deterministic across runs, the same rule users.email gets.
            if (!seenTokens.Add(invitation.InvitationToken))
            {
                report.Skip(MigrationRules.InvitationDuplicateToken, "surveyinvitations",
                    document.Id.ToString(),
                    "another invitation already carries this token; the unique index would refuse it",
                    "invitation_token");
                continue;
            }

            var existing = await db.SurveyInvitations.FindAsync([invitation.Id], ct);
            if (existing is null)
            {
                db.SurveyInvitations.Add(invitation);
            }
            else
            {
                existing.SurveyId = invitation.SurveyId;
                existing.UserId = invitation.UserId;
                existing.CompanyId = invitation.CompanyId;
                existing.Email = invitation.Email;
                existing.InvitationToken = invitation.InvitationToken;
                existing.Status = invitation.Status;
                existing.SentAt = invitation.SentAt;
                existing.OpenedAt = invitation.OpenedAt;
                existing.StartedAt = invitation.StartedAt;
                existing.CompletedAt = invitation.CompletedAt;
                existing.ReminderCount = invitation.ReminderCount;
                existing.LastReminderSent = invitation.LastReminderSent;
                existing.ExpiresAt = invitation.ExpiresAt;
                existing.Metadata = invitation.Metadata;
                existing.CreatedAt = invitation.CreatedAt;
                existing.UpdatedAt = invitation.UpdatedAt;
            }

            written++;

            // One row per invitee per survey: the second-largest table after responses.
            if (++sinceSave >= 500)
            {
                await SaveAsync(ct);
                db.ChangeTracker.Clear();
                sinceSave = 0;
            }
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("surveyinvitations", source, written, report.SkipCount("surveyinvitations")));
    }

    /// <summary>
    /// Versions carry a unique (survey, version_number) index the legacy collection
    /// also had - so a duplicate is refused here by name rather than by a constraint
    /// violation that would abort the batch.
    /// </summary>
    private async Task LoadSurveyVersionsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var seen = new HashSet<(Guid Survey, int Number)>();
        await foreach (var document in Read<LegacySurveyVersion>("surveyversions", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (SurveyVersionMapper.Map(document, context) is not { } version)
            {
                continue;
            }

            if (!seen.Add((version.SurveyId, version.VersionNumber)))
            {
                report.Skip(MigrationRules.SurveyVersionDuplicateNumber, "surveyversions",
                    document.Id.ToString(),
                    $"another version of this survey already carries number {version.VersionNumber}; "
                    + "the unique index would refuse it",
                    "version_number");
                continue;
            }

            var existing = await db.SurveyVersions.FindAsync([version.Id], ct);
            if (existing is null)
            {
                db.SurveyVersions.Add(version);
            }
            else
            {
                existing.SurveyId = version.SurveyId;
                existing.VersionNumber = version.VersionNumber;
                existing.TitleEn = version.TitleEn;
                existing.TitleEs = version.TitleEs;
                existing.DescriptionEn = version.DescriptionEn;
                existing.DescriptionEs = version.DescriptionEs;
                existing.Changes = version.Changes;
                existing.Reason = version.Reason;
                existing.CreatedBy = version.CreatedBy;
                existing.QuestionsSnapshot = version.QuestionsSnapshot;
                existing.DemographicsSnapshot = version.DemographicsSnapshot;
                existing.SettingsSnapshot = version.SettingsSnapshot;
                existing.CreatedAt = version.CreatedAt;
            }

            written++;
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("surveyversions", source, written, report.SkipCount("surveyversions")));
    }

    private async Task LoadSurveyAuditLogsAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var sinceSave = 0;
        await foreach (var document in Read<LegacySurveyAuditLog>("surveyauditlogs", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (SurveyAuditLogMapper.Map(document, context) is not { } entry)
            {
                continue;
            }

            var existing = await db.SurveyAuditLogs.FindAsync([entry.Id], ct);
            if (existing is null)
            {
                db.SurveyAuditLogs.Add(entry);
            }
            else
            {
                existing.SurveyId = entry.SurveyId;
                existing.Action = entry.Action;
                existing.EntityType = entry.EntityType;
                existing.EntityId = entry.EntityId;
                existing.Changes = entry.Changes;
                existing.UserId = entry.UserId;
                existing.UserName = entry.UserName;
                existing.UserEmail = entry.UserEmail;
                existing.UserRole = entry.UserRole;
                existing.Timestamp = entry.Timestamp;
                existing.IpAddress = entry.IpAddress;
                existing.UserAgent = entry.UserAgent;
                existing.SessionId = entry.SessionId;
                existing.Metadata = entry.Metadata;
            }

            written++;

            // An audit feed grows with every edit ever made, so it gets the responses
            // stage's bounded-memory treatment rather than one giant tracked batch.
            if (++sinceSave >= 500)
            {
                await SaveAsync(ct);
                db.ChangeTracker.Clear();
                sinceSave = 0;
            }
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("surveyauditlogs", source, written, report.SkipCount("surveyauditlogs")));
    }

    /// <summary>
    /// The volume driver. Two departures from the other stages, both because row
    /// counts are unknown until the census (sub-issue A) runs against a dump:
    /// the tracker is flushed and CLEARED every 500 documents (the readers' own batch
    /// size) so memory stays bounded, and a kill between batches leaves partial
    /// collection state - which deterministic upserts converge on re-run exactly as a
    /// stage-boundary kill does, per sub-issue D's argument. The per-response child
    /// queries are the simple, correct shape; if the census says millions of rows,
    /// batching those lookups is the tuning knob.
    /// </summary>
    private async Task LoadResponsesAsync(MappingContext context, CancellationToken ct)
    {
        long source = 0;
        var written = 0;
        var sinceSave = 0;
        await foreach (var document in Read<LegacyResponse>("responses", ct))
        {
            source++;
            ct.ThrowIfCancellationRequested();
            if (ResponseMapper.Map(document, context) is not { } mapped)
            {
                continue;
            }

            var existing = await db.Responses.FindAsync([mapped.Response.Id], ct);
            if (existing is null)
            {
                db.Responses.Add(mapped.Response);
            }
            else
            {
                existing.SurveyId = mapped.Response.SurveyId;
                existing.UserId = mapped.Response.UserId;
                existing.SessionId = mapped.Response.SessionId;
                existing.CompanyId = mapped.Response.CompanyId;
                existing.DepartmentId = mapped.Response.DepartmentId;
                existing.Language = mapped.Response.Language;
                existing.IsComplete = mapped.Response.IsComplete;
                existing.IsAnonymous = mapped.Response.IsAnonymous;
                existing.StartTime = mapped.Response.StartTime;
                existing.CompletionTime = mapped.Response.CompletionTime;
                existing.TotalTimeSeconds = mapped.Response.TotalTimeSeconds;
                existing.IpAddress = mapped.Response.IpAddress;
                existing.UserAgent = mapped.Response.UserAgent;
                existing.CreatedAt = mapped.Response.CreatedAt;
                existing.UpdatedAt = mapped.Response.UpdatedAt;
            }

            // Answer and demographic rows replace wholesale, the child-row precedent.
            var staleAnswers = await db.QuestionResponses
                .Where(a => a.ResponseId == mapped.Response.Id).ToListAsync(ct);
            db.QuestionResponses.RemoveRange(staleAnswers);
            db.QuestionResponses.AddRange(mapped.Answers);

            var staleDemographics = await db.ResponseDemographics
                .Where(d => d.ResponseId == mapped.Response.Id).ToListAsync(ct);
            db.ResponseDemographics.RemoveRange(staleDemographics);
            db.ResponseDemographics.AddRange(mapped.Demographics);

            written++;
            if (++sinceSave >= 500)
            {
                await SaveAsync(ct);
                db.ChangeTracker.Clear();
                sinceSave = 0;
            }
        }

        await SaveAsync(ct);
        _results.Add(new CollectionResult("responses", source, written, report.SkipCount("responses")));
    }

    /// <summary>
    /// The second pass: cheap UPDATEs on deterministic ids, cycle-proof by
    /// construction. Covers only what this run mapped - a filtered run's pass is
    /// filtered with it.
    /// </summary>
    private async Task SecondPassAsync(MappingContext context, CancellationToken ct)
    {
        foreach (var mapped in _departmentsThisRun)
        {
            var department = await db.Departments.FindAsync([mapped.Department.Id], ct);
            if (department is null)
            {
                continue; // dry run
            }

            department.ParentDepartmentId = ResolveSecondPassRef(
                "departments", mapped.Department.LegacyExternalId!, "hierarchy.parent_department_id",
                mapped.LegacyParentId, context.Departments, DepartmentMapper.Collection);

            var users = (await db.Users.Select(u => u.Id).ToListAsync(ct)).ToHashSet();
            users.UnionWith(db.Users.Local.Select(u => u.Id));
            department.ManagerId = ResolveSecondPassRef(
                "departments", mapped.Department.LegacyExternalId!, "manager_id",
                mapped.LegacyManagerId, users, UserMapper.Collection);
        }

        if (_usersThisRun.Count > 0)
        {
            var users = (await db.Users.Select(u => u.Id).ToListAsync(ct)).ToHashSet();
            users.UnionWith(db.Users.Local.Select(u => u.Id));
            foreach (var mapped in _usersThisRun)
            {
                var user = await db.Users.FindAsync([mapped.User.Id], ct);
                if (user is null)
                {
                    continue; // dry run
                }

                user.ManagerId = ResolveSecondPassRef(
                    "users", mapped.User.PersonaExternalId!, "manager_id",
                    mapped.LegacyManagerId, users, UserMapper.Collection);
            }
        }

        await SaveAsync(ct);
    }

    private Guid? ResolveSecondPassRef(
        string collection, string legacyId, string field,
        string? reference, IReadOnlySet<Guid> targets, string referencedCollection)
    {
        var classification = ReferenceResolver.Classify(referencedCollection, reference, targets);
        switch (classification.Kind)
        {
            case ReferenceKind.Resolved:
                return classification.TargetId;
            case ReferenceKind.Absent:
                return null;
            default:
                report.Degraded(
                    classification.Kind == ReferenceKind.Malformed
                        ? MigrationRules.MalformedReference
                        : MigrationRules.DanglingReference,
                    collection, legacyId, field,
                    $"'{reference}' is {classification.Kind}; loaded as NULL");
                return null;
        }
    }

    /// <summary>
    /// The design doc's integrity check: legacy level/path are derived values with no
    /// target column, so they are recomputed from ParentDepartmentId and every
    /// disagreement is a report line - they catch a mis-loaded parent chain the way a
    /// checksum catches a bad copy.
    /// </summary>
    private void AssertDepartmentHierarchy()
    {
        if (_departmentsThisRun.Count == 0)
        {
            return;
        }

        var byId = _departmentsThisRun.ToDictionary(d => d.Department.Id);
        var byLegacyId = _departmentsThisRun.ToDictionary(d => d.Department.LegacyExternalId!, StringComparer.Ordinal);

        foreach (var mapped in _departmentsThisRun)
        {
            var (level, path) = RecomputeHierarchy(mapped, byLegacyId);
            if (mapped.LegacyLevel is { } legacyLevel && legacyLevel != level)
            {
                report.Integrity(MigrationRules.DepartmentHierarchyMismatch, "departments",
                    mapped.Department.LegacyExternalId!, "hierarchy.level",
                    $"legacy says {legacyLevel}, the loaded parent chain says {level}");
            }

            if (mapped.LegacyPath is { } legacyPath && !string.Equals(legacyPath, path, StringComparison.Ordinal))
            {
                report.Integrity(MigrationRules.DepartmentHierarchyMismatch, "departments",
                    mapped.Department.LegacyExternalId!, "hierarchy.path",
                    $"legacy says '{legacyPath}', the loaded parent chain says '{path}'");
            }
        }
    }

    private static (int Level, string Path) RecomputeHierarchy(
        MappedDepartment department, IReadOnlyDictionary<string, MappedDepartment> byLegacyId)
    {
        // Mirrors the legacy pre-save hook: path segments are the lowercased,
        // whitespace-collapsed names up the parent chain.
        var segments = new List<string>();
        var current = department;
        var hops = 0;
        while (true)
        {
            segments.Insert(0, Slug(current.Department.Name));
            if (current.LegacyParentId is null
                || !byLegacyId.TryGetValue(current.LegacyParentId, out var parent)
                || ++hops > 64)
            {
                break;
            }

            current = parent;
        }

        return (segments.Count - 1, string.Join('/', segments));
    }

    private static string Slug(string name)
        => System.Text.RegularExpressions.Regex.Replace(name.ToLowerInvariant(), @"\s+", "-");

    private async IAsyncEnumerable<TDocument> Read<TDocument>(
        string collection, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
        where TDocument : LegacyDocument
    {
        var reader = new LegacyCollectionReader<TDocument>(collection);
        await foreach (var document in reader.ReadAllAsync(mongo, ct))
        {
            yield return (TDocument)document;
        }
    }

    private Task<int> SaveAsync(CancellationToken ct)
        => dryRun ? Task.FromResult(0) : db.SaveChangesAsync(ct);
}
