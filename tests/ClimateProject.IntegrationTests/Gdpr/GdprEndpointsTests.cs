using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Gdpr;
using ClimateProject.Application.Notifications;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Gdpr;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Gdpr;

/// <summary>
/// The four data-subject routes (#144), end to end.
///
/// <para>Two things this class deliberately does <b>not</b> do. It does not assert on a
/// hand-written list of tables — the section set is compared against
/// <see cref="SubjectDataMap"/>, so a table added to the map and not to the exporter fails
/// here rather than quietly shrinking the response. And it does not check erasure by re-reading
/// through the API: the API filters, so a row left behind would be invisible either way. Every
/// erasure assertion reads the table.</para>
/// </summary>
[Collection("Postgres")]
public class GdprEndpointsTests : IAsyncLifetime
{
    private readonly PostgresContainerFixture _postgres;
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"gdpr-{Guid.NewGuid():N}.test";
    private readonly string _otherDomain = $"gdpr-other-{Guid.NewGuid():N}.test";
    private Guid _companyId;
    private Guid _otherCompanyId;

    public GdprEndpointsTests(PostgresContainerFixture postgres)
    {
        _postgres = postgres;
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        await using var db = NewContext();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "GDPR Co",
            EmailDomain = _domain,
            Settings = new CompanySettings { Timezone = "UTC" },
            CreatedAt = DateTimeOffset.UtcNow,
        };
        var other = new Company
        {
            Id = Guid.NewGuid(),
            Name = "GDPR Other Co",
            EmailDomain = _otherDomain,
            Settings = new CompanySettings { Timezone = "UTC" },
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.AddRange(company, other);
        await db.SaveChangesAsync();
        _companyId = company.Id;
        _otherCompanyId = other.Id;
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private ClimateProjectDbContext NewContext()
        => new(new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(_postgres.ConnectionString)
            .Options);

    private async Task<(HttpClient Client, Guid UserId, string Email)> SignInAsync(
        string role, Guid? companyId = null, string? domain = null)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{domain ?? _domain}";
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "A-good-passw0rd"));

        Guid userId;
        await using (var db = NewContext())
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = companyId ?? _companyId;
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return (client, userId, email);
    }

    /// <summary>
    /// Seeds one row in each table the subject can appear in, so an export that skips a table
    /// produces an empty section rather than an accidentally-correct one.
    /// </summary>
    private async Task<SeededSubject> SeedSubjectDataAsync(Guid subjectId, string subjectEmail, Guid authorId)
    {
        await using var db = NewContext();
        var now = DateTimeOffset.UtcNow;

        var field = new DemographicField
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Field = $"tenure-{Guid.NewGuid():N}",
            LabelEn = "Tenure",
            LabelEs = "Antiguedad",
            Type = "select",
            Required = false,
            IsActive = true,
            Order = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.DemographicFields.Add(field);

        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            CreatedBy = authorId,
            TitleEn = "Climate 2026",
            TitleEs = "Clima 2026",
            DescriptionEn = "d",
            DescriptionEs = "d",
            Type = "general_climate",
            Status = "active",
            StartDate = now,
            EndDate = now.AddDays(30),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Surveys.Add(survey);

        var question = new Question
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            TextEn = "How are things?",
            TextEs = "Como van las cosas?",
            Type = "open_ended",
            Required = false,
            Order = 1,
        };
        db.Questions.Add(question);

        var response = new Response
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            UserId = subjectId,
            CompanyId = _companyId,
            SessionId = Guid.NewGuid().ToString("N"),
            IsComplete = true,
            IsAnonymous = false,
            StartTime = now,
            CompletionTime = now,
            IpAddress = "203.0.113.9",
            UserAgent = "test-agent",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Responses.Add(response);
        db.QuestionResponses.Add(new QuestionResponse
        {
            ResponseId = response.Id,
            QuestionId = question.Id,
            ResponseValue = "\"my honest opinion\"",
            ResponseText = "my honest opinion",
        });
        db.ResponseDemographics.Add(new ResponseDemographic
        {
            ResponseId = response.Id,
            Field = "tenure",
            // response_demographics.value is jsonb, so the stored value is a JSON scalar.
            Value = "\"2-5\"",
        });

        // Somebody else's answer to the same survey. It must never appear in this subject's
        // export, however the export reaches surveys.
        var otherRespondent = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            Email = $"colleague-{Guid.NewGuid():N}@{_domain}",
            Name = "Colleague",
            Role = Roles.Employee,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(otherRespondent);
        var otherResponse = new Response
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            UserId = otherRespondent.Id,
            CompanyId = _companyId,
            SessionId = Guid.NewGuid().ToString("N"),
            IsComplete = true,
            StartTime = now,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Responses.Add(otherResponse);
        db.QuestionResponses.Add(new QuestionResponse
        {
            ResponseId = otherResponse.Id,
            QuestionId = question.Id,
            ResponseValue = "\"colleague-secret-opinion\"",
            ResponseText = "colleague-secret-opinion",
        });

        db.UserDemographics.Add(new UserDemographic
        {
            UserId = subjectId,
            DemographicFieldId = field.Id,
            Value = "2-5",
            CreatedAt = now,
            UpdatedAt = now,
        });

        var surveyInvitationToken = Guid.NewGuid().ToString("N");
        db.SurveyInvitations.Add(new SurveyInvitation
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            UserId = subjectId,
            CompanyId = _companyId,
            Email = subjectEmail,
            InvitationToken = surveyInvitationToken,
            ExpiresAt = now.AddDays(7),
            CreatedAt = now,
            UpdatedAt = now,
        });

        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            CreatedBy = authorId,
            TitleEn = "Pulse",
            TitleEs = "Pulso",
            Status = "active",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        db.MicroclimateInvitations.Add(new MicroclimateInvitation
        {
            Id = Guid.NewGuid(),
            MicroclimateId = microclimate.Id,
            UserId = subjectId,
            CompanyId = _companyId,
            Email = subjectEmail,
            InvitationToken = Guid.NewGuid().ToString("N"),
            ExpiresAt = now.AddDays(7),
            CreatedAt = now,
            UpdatedAt = now,
        });

        db.Notifications.Add(new Notification
        {
            Id = Guid.NewGuid(),
            UserId = subjectId,
            CompanyId = _companyId,
            Type = "survey_invitation",
            Channel = NotificationChannels.Email,
            Status = NotificationStatuses.Sent,
            Title = "Please respond",
            Message = "Your survey is open",
            ScheduledFor = now,
            CreatedAt = now,
            UpdatedAt = now,
        });

        db.SurveyDrafts.Add(new SurveyDraft
        {
            Id = Guid.NewGuid(),
            UserId = subjectId,
            CompanyId = _companyId,
            SessionId = Guid.NewGuid().ToString("N"),
            DraftData = "{\"title\":\"work in progress\"}",
            CurrentStep = 1,
            Version = 1,
            ExpiresAt = SurveyDraftRetention.ExpiresAt(now),
            CreatedAt = now,
            UpdatedAt = now,
        });

        db.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            UserId = subjectId,
            CompanyId = _companyId,
            Action = "login",
            Resource = "user",
            Success = true,
            IpAddress = "203.0.113.9",
            Timestamp = now,
        });

        db.SurveyAuditLogs.Add(new SurveyAuditLog
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            Action = "updated",
            EntityType = "survey",
            UserId = subjectId,
            UserName = "Test User",
            UserEmail = subjectEmail,
            UserRole = Roles.Employee,
            Timestamp = now,
        });

        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = subjectEmail,
            CompanyId = _companyId,
            InvitedBy = authorId,
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = InvitationValidation.TypeEmployeeDirect,
            Role = Roles.Employee,
            Status = InvitationValidation.StatusAccepted,
            ExpiresAt = now.AddDays(7),
            AcceptedAt = now,
        };
        db.UserInvitations.Add(invitation);
        db.UserInvitationDemographics.Add(new UserInvitationDemographic
        {
            InvitationId = invitation.Id,
            DemographicFieldId = field.Id,
            Value = "2-5",
        });

        var snapshot = new DemographicSnapshot
        {
            Id = Guid.NewGuid(),
            CompanyId = _companyId,
            SurveyId = survey.Id,
            CreatedBy = authorId,
            Reason = "baseline",
            Timestamp = now,
            Version = 1,
            IsActive = true,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.DemographicSnapshots.Add(snapshot);
        db.DemographicSnapshotEntries.Add(new DemographicSnapshotEntry
        {
            Id = Guid.NewGuid(),
            SnapshotId = snapshot.Id,
            UserId = subjectId,
            Department = "Engineering",
            Role = Roles.Employee,
            Tenure = "2-5",
        });

        await db.SaveChangesAsync();

        return new SeededSubject(survey.Id, response.Id, otherResponse.Id, surveyInvitationToken);
    }

    private sealed record SeededSubject(Guid SurveyId, Guid ResponseId, Guid OtherResponseId, string SurveyInvitationToken);

    /// <summary>
    /// Words that appear nowhere else, one per table, inside the other tenant's free-form
    /// columns. Assertions search for these rather than for the whole payload: a payload is a
    /// JSON string inside a JSON response, so its quotes come back escaped and a verbatim match
    /// on it would pass whether or not the value leaked. One marker per table rather than one
    /// shared marker, so a failure names the path that leaked rather than only that something
    /// did.
    /// </summary>
    private const string ForeignPayloadMarker = "other-tenant-private-user-invitation";

    private const string ForeignSurveyInvitationMarker = "other-tenant-private-survey-invitation";
    private const string ForeignMicroclimateInvitationMarker = "other-tenant-private-microclimate-invitation";
    private const string ForeignSurveyAuditMarker = "other-tenant-private-survey-audit-change";
    private const string ForeignReportMarker = "other-tenant-private-report-title";

    /// <summary>The free-form payload on the other tenant's invitation.</summary>
    private const string ForeignPayload = "{\"note\": \"" + ForeignPayloadMarker + "\"}";

    private const string ForeignSurveyInvitationPayload =
        "{\"note\": \"" + ForeignSurveyInvitationMarker + "\"}";

    private const string ForeignMicroclimateInvitationPayload =
        "{\"note\": \"" + ForeignMicroclimateInvitationMarker + "\"}";

    private const string ForeignSurveyAuditPayload = "{\"note\": \"" + ForeignSurveyAuditMarker + "\"}";

    /// <summary>
    /// A second company's rows carrying the <i>same</i> email address — one in each of the five
    /// tables the subject can be reached in by address rather than by key.
    /// </summary>
    /// <remarks>
    /// <para>This is the shape both tenant tests turn on and it is not contrived: an employee's
    /// work address can be held by another customer of the platform, and an address is not
    /// tenant-unique. <c>user_invitations</c> identifies its invitee by email alone because no
    /// user row exists until they accept; <c>survey_invitations</c>, <c>microclimate_invitations</c>
    /// and <c>survey_audit_logs</c> each denormalise an address of their own; and
    /// <c>reports.shared_with</c> is a bare <c>text[]</c> that no code today fixes the form of,
    /// so it is matched on the address as well as on the id.</para>
    ///
    /// <para>All five are seeded, and not just the first, because each one is matched by a
    /// separate predicate: a seed that populates only <c>user_invitations</c> witnesses only the
    /// <c>user_invitations</c> predicate, and the other four can be removed with the suite still
    /// green. Every row belongs to the other tenant — its company, its administrator, its survey,
    /// its payload — and a caller with rights only in <c>_companyId</c> has no claim on any of
    /// it, in either direction: none of it may come back in their export and their erasure may
    /// not rewrite any of it.</para>
    /// </remarks>
    private async Task<ForeignTenantRows> SeedForeignTenantInvitationAsync(string subjectEmail)
    {
        var (_, foreignAdminId, _) = await SignInAsync(Roles.CompanyAdmin, _otherCompanyId, _otherDomain);

        await using var db = NewContext();
        var now = DateTimeOffset.UtcNow;

        var field = new DemographicField
        {
            Id = Guid.NewGuid(),
            CompanyId = _otherCompanyId,
            Field = $"tenure-{Guid.NewGuid():N}",
            LabelEn = "Tenure",
            LabelEs = "Antiguedad",
            Type = "select",
            Required = false,
            IsActive = true,
            Order = 1,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.DemographicFields.Add(field);

        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = subjectEmail,
            CompanyId = _otherCompanyId,
            InvitedBy = foreignAdminId,
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = InvitationValidation.TypeEmployeeDirect,
            Role = Roles.Leader,
            Status = InvitationValidation.StatusPending,
            InvitationData = ForeignPayload,
            ExpiresAt = now.AddDays(7),
        };
        db.UserInvitations.Add(invitation);
        db.UserInvitationDemographics.Add(new UserInvitationDemographic
        {
            InvitationId = invitation.Id,
            DemographicFieldId = field.Id,
            Value = "6-10",
        });

        // The other tenant's own survey. survey_audit_logs carries no company of its own, so
        // this is what puts the audit row below in a tenant the caller has no rights in.
        var survey = new Survey
        {
            Id = Guid.NewGuid(),
            CompanyId = _otherCompanyId,
            CreatedBy = foreignAdminId,
            TitleEn = "Other tenant climate",
            TitleEs = "Clima de otra empresa",
            DescriptionEn = "d",
            DescriptionEs = "d",
            Type = "general_climate",
            Status = "active",
            StartDate = now,
            EndDate = now.AddDays(30),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Surveys.Add(survey);

        var surveyInvitation = new SurveyInvitation
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            // Somebody else's account, so the row is reachable by the address on it and by
            // nothing else -- which is the predicate under test.
            UserId = foreignAdminId,
            CompanyId = _otherCompanyId,
            Email = subjectEmail,
            InvitationToken = Guid.NewGuid().ToString("N"),
            Metadata = ForeignSurveyInvitationPayload,
            ExpiresAt = now.AddDays(7),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.SurveyInvitations.Add(surveyInvitation);

        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(),
            CompanyId = _otherCompanyId,
            CreatedBy = foreignAdminId,
            TitleEn = "Other tenant pulse",
            TitleEs = "Pulso de otra empresa",
            Status = "active",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);

        var microclimateInvitation = new MicroclimateInvitation
        {
            Id = Guid.NewGuid(),
            MicroclimateId = microclimate.Id,
            UserId = foreignAdminId,
            CompanyId = _otherCompanyId,
            Email = subjectEmail,
            InvitationToken = Guid.NewGuid().ToString("N"),
            Metadata = ForeignMicroclimateInvitationPayload,
            ExpiresAt = now.AddDays(7),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.MicroclimateInvitations.Add(microclimateInvitation);

        var surveyAuditLog = new SurveyAuditLog
        {
            Id = Guid.NewGuid(),
            SurveyId = survey.Id,
            Action = "updated",
            EntityType = "survey",
            UserId = foreignAdminId,
            UserName = "Other Tenant Admin",
            UserEmail = subjectEmail,
            UserRole = Roles.CompanyAdmin,
            Changes = ForeignSurveyAuditPayload,
            Timestamp = now,
        };
        db.SurveyAuditLogs.Add(surveyAuditLog);

        var report = new Report
        {
            Id = Guid.NewGuid(),
            CompanyId = _otherCompanyId,
            CreatedBy = foreignAdminId,
            Title = ForeignReportMarker,
            Type = "custom",
            Format = "pdf",
            SharedWith = [subjectEmail],
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Reports.Add(report);

        await db.SaveChangesAsync();

        return new ForeignTenantRows(
            invitation.Id,
            surveyInvitation.Id,
            microclimateInvitation.Id,
            surveyAuditLog.Id,
            report.Id,
            survey.Id,
            microclimate.Id,
            foreignAdminId);
    }

    /// <summary>
    /// The other tenant's row in each of the five email-matched tables, plus the parents that
    /// place two of them in that tenant and the administrator who owns them all. Every one of
    /// these identifiers is that tenant's, and none may appear in the caller's export.
    /// </summary>
    private sealed record ForeignTenantRows(
        Guid InvitationId,
        Guid SurveyInvitationId,
        Guid MicroclimateInvitationId,
        Guid SurveyAuditLogId,
        Guid ReportId,
        Guid SurveyId,
        Guid MicroclimateId,
        Guid InviterId);

    /// <summary>
    /// Every column of each of the other tenant's five rows, exactly as Postgres renders the
    /// whole row.
    /// </summary>
    /// <remarks>
    /// <c>to_jsonb(t)</c> rather than a hand-written column list, for the same reason the export
    /// flattens through <c>ChangeTracker</c> metadata: a column added to one of these tables
    /// later is compared with no change here. Table and key column come from <c>db.Model</c>,
    /// so neither is a literal that can drift from the schema.
    /// </remarks>
    private async Task<SortedDictionary<string, string>> ForeignTenantRowsAsTextAsync(ForeignTenantRows foreign)
    {
        await using var db = NewContext();
        var rows = new SortedDictionary<string, string>(StringComparer.Ordinal);

        await AddAsync<UserInvitation>(foreign.InvitationId);
        await AddAsync<SurveyInvitation>(foreign.SurveyInvitationId);
        await AddAsync<MicroclimateInvitation>(foreign.MicroclimateInvitationId);
        await AddAsync<SurveyAuditLog>(foreign.SurveyAuditLogId);
        await AddAsync<Report>(foreign.ReportId);

        return rows;

        async Task AddAsync<T>(Guid id)
            where T : class
        {
            var entityType = db.Model.FindEntityType(typeof(T))!;
            var table = entityType.GetTableName()!;
            var key = entityType.FindPrimaryKey()!.Properties.Single().GetColumnName()!;
            var sql = $"SELECT to_jsonb(t)::text AS \"Value\" FROM {Quote(table)} t WHERE t.{Quote(key)} = {{0}}";
            rows[table] = await db.Database.SqlQueryRaw<string>(sql, id).SingleAsync();
        }
    }

    [Fact]
    public async Task Access_export_never_reaches_a_row_in_a_tenant_the_caller_has_no_rights_in()
    {
        var (_, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);
        var foreign = await SeedForeignTenantInvitationAsync(subjectEmail);

        var raw = await (await adminClient.GetAsync($"/gdpr/access?userId={subjectId}")).Content.ReadAsStringAsync();
        var export = JsonSerializer.Deserialize<JsonElement>(raw);

        // One assertion per email-matched path, named, because a single "nothing of the other
        // tenant is here" would go red without saying which predicate stopped holding.
        AssertWithheld(raw, ForeignPayloadMarker, "user_invitations.invitation_data");
        AssertWithheld(raw, ForeignSurveyInvitationMarker, "survey_invitations.metadata");
        AssertWithheld(raw, ForeignMicroclimateInvitationMarker, "microclimate_invitations.metadata");
        AssertWithheld(raw, ForeignSurveyAuditMarker, "survey_audit_logs.changes");
        AssertWithheld(raw, ForeignReportMarker, "reports.title");

        AssertWithheld(raw, foreign.InvitationId, "the other tenant's user_invitations row");
        AssertWithheld(raw, foreign.SurveyInvitationId, "the other tenant's survey_invitations row");
        AssertWithheld(raw, foreign.MicroclimateInvitationId, "the other tenant's microclimate_invitations row");
        AssertWithheld(raw, foreign.SurveyAuditLogId, "the other tenant's survey_audit_logs row");
        AssertWithheld(raw, foreign.ReportId, "the other tenant's reports row");

        // The parents that place two of those rows in that tenant, the administrator who owns
        // them, and the tenant itself: each is disclosed by the row that carries it as a column.
        AssertWithheld(raw, foreign.SurveyId, "the other tenant's survey");
        AssertWithheld(raw, foreign.MicroclimateId, "the other tenant's microclimate");
        AssertWithheld(raw, foreign.InviterId, "the other tenant's administrator");
        AssertWithheld(raw, _otherCompanyId, "the other tenant");

        // The caller's own tenant's rows for the same address are still returned, so the scope
        // is an authority predicate and not an accidental "return nothing".
        AssertSingleRecordInTheCallersTenant(export, "UserInvitation");
        AssertSingleRecordInTheCallersTenant(export, "SurveyInvitation");
        AssertSingleRecordInTheCallersTenant(export, "MicroclimateInvitation");
        Assert.Equal(1, Section(export, "SurveyAuditLog").GetProperty("recordCount").GetInt32());

        // And a super admin, whose authority is every tenant, reaches all five. That is what
        // makes the four assertions above a statement about authority rather than about a query
        // that happens to return nothing.
        var (superClient, _, _) = await SignInAsync(Roles.SuperAdmin);
        var superRaw = await (await superClient.GetAsync($"/gdpr/access?userId={subjectId}"))
            .Content.ReadAsStringAsync();

        AssertReached(superRaw, ForeignPayloadMarker, "user_invitations");
        AssertReached(superRaw, ForeignSurveyInvitationMarker, "survey_invitations");
        AssertReached(superRaw, ForeignMicroclimateInvitationMarker, "microclimate_invitations");
        AssertReached(superRaw, ForeignSurveyAuditMarker, "survey_audit_logs");
        AssertReached(superRaw, ForeignReportMarker, "reports.shared_with");
    }

    private static void AssertWithheld(string export, string marker, string source)
        => Assert.True(
            !export.Contains(marker, StringComparison.Ordinal),
            $"The export handed a company admin {source}, which belongs to a tenant they have no rights in. "
            + "The company predicate on that lookup is not holding.");

    private static void AssertWithheld(string export, Guid id, string what)
        => Assert.True(
            !export.Contains(id.ToString(), StringComparison.OrdinalIgnoreCase),
            $"The export named {what} ({id}) to a company admin who has no rights in that tenant. "
            + "The company predicate on the lookup that reaches it is not holding.");

    private static void AssertReached(string export, string marker, string table)
        => Assert.True(
            export.Contains(marker, StringComparison.Ordinal),
            $"A super admin's export did not reach the other tenant's {table} row. Either the scope is not the "
            + "authority predicate it is meant to be, or the seed never created the row -- in which case the "
            + "company admin's half of this test passes for the wrong reason.");

    private void AssertSingleRecordInTheCallersTenant(JsonElement export, string entity)
    {
        var records = Section(export, entity).GetProperty("records").EnumerateArray().ToList();
        Assert.Single(records);
        Assert.Equal(_companyId.ToString(), records[0].GetProperty("CompanyId").GetString());
    }

    [Fact]
    public async Task Erasure_does_not_touch_a_tenant_the_caller_has_no_rights_in()
    {
        var (_, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);
        var foreign = await SeedForeignTenantInvitationAsync(subjectEmail);

        // Every column of all five of the other tenant's rows, before anything runs. Compared
        // whole afterwards, so a treatment that reaches into that tenant is caught whichever
        // column it writes -- not only the ones this test would have thought to name.
        var before = await ForeignTenantRowsAsTextAsync(foreign);

        var response = await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var after = await ForeignTenantRowsAsTextAsync(foreign);
        foreach (var (table, row) in before)
        {
            Assert.True(
                string.Equals(row, after[table], StringComparison.Ordinal),
                $"A company admin's erasure rewrote a {table} row in a tenant they have no rights in. The "
                + $"company predicate on that lookup is not holding.{Environment.NewLine}"
                + $"before: {row}{Environment.NewLine}after:  {after[table]}");
        }

        await using var db = NewContext();

        // Named as well as compared, because the whole-row comparison above would also stay
        // green if the seed had never written the address here.
        var untouched = await db.UserInvitations.SingleAsync(i => i.Id == foreign.InvitationId);
        Assert.Equal(subjectEmail, untouched.Email);
        Assert.Equal(ForeignPayload, untouched.InvitationData);
        Assert.Equal(1, await db.UserInvitationDemographics.CountAsync(d => d.InvitationId == foreign.InvitationId));
        Assert.Equal(
            subjectEmail,
            (await db.SurveyInvitations.SingleAsync(i => i.Id == foreign.SurveyInvitationId)).Email);
        Assert.Equal(
            subjectEmail,
            (await db.MicroclimateInvitations.SingleAsync(i => i.Id == foreign.MicroclimateInvitationId)).Email);
        Assert.Equal(
            subjectEmail,
            (await db.SurveyAuditLogs.SingleAsync(a => a.Id == foreign.SurveyAuditLogId)).UserEmail);
        Assert.Contains(
            subjectEmail,
            (await db.Reports.SingleAsync(r => r.Id == foreign.ReportId)).SharedWith);

        // Erased: the invitation in the tenant the caller does administer.
        Assert.Equal(
            0,
            await db.UserInvitations.CountAsync(i => i.Email == subjectEmail && i.CompanyId == _companyId));
    }

    /// <summary>
    /// The four link properties the map declares as an address rather than a key —
    /// <c>SurveyInvitation.Email</c>, <c>MicroclimateInvitation.Email</c>,
    /// <c>SurveyAuditLog.UserEmail</c> and <c>User.Email</c> — are searched, not merely
    /// declared.
    /// </summary>
    /// <remarks>
    /// The map's guard test runs one way only: it requires every email column on a classified
    /// table to be declared as a link, and it checks that every exported record names a
    /// declared link. Neither direction notices a declaration that no query ever uses, so all
    /// four of these were declared and none was searched — the export and the erasure reached
    /// those rows through <c>user_id</c> alone.
    ///
    /// This seeds the case that separates the two: rows carrying the subject's address whose
    /// <c>user_id</c> is somebody else's. It is an anomaly rather than a shape the product
    /// creates today — those columns are non-nullable — but it is exactly what the declaration
    /// claims to cover, and without it the claim is untested either way.
    /// </remarks>
    [Fact]
    public async Task A_row_carrying_the_subjects_address_under_another_user_id_is_exported_and_erased()
    {
        var (_, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        var (_, colleagueId, _) = await SignInAsync(Roles.Employee);
        var seeded = await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);

        var surveyInvitationId = Guid.NewGuid();
        var microclimateInvitationId = Guid.NewGuid();
        var auditId = Guid.NewGuid();
        await using (var db = NewContext())
        {
            var now = DateTimeOffset.UtcNow;
            var microclimateId = await db.MicroclimateInvitations
                .Where(i => i.UserId == subjectId).Select(i => i.MicroclimateId).SingleAsync();

            db.SurveyInvitations.Add(new SurveyInvitation
            {
                Id = surveyInvitationId,
                SurveyId = seeded.SurveyId,
                UserId = colleagueId,
                CompanyId = _companyId,
                Email = subjectEmail,
                InvitationToken = Guid.NewGuid().ToString("N"),
                ExpiresAt = now.AddDays(7),
                CreatedAt = now,
                UpdatedAt = now,
            });
            db.MicroclimateInvitations.Add(new MicroclimateInvitation
            {
                Id = microclimateInvitationId,
                MicroclimateId = microclimateId,
                UserId = colleagueId,
                CompanyId = _companyId,
                Email = subjectEmail,
                InvitationToken = Guid.NewGuid().ToString("N"),
                ExpiresAt = now.AddDays(7),
                CreatedAt = now,
                UpdatedAt = now,
            });
            db.SurveyAuditLogs.Add(new SurveyAuditLog
            {
                Id = auditId,
                SurveyId = seeded.SurveyId,
                Action = "updated",
                EntityType = "survey",
                UserId = colleagueId,
                UserName = "Test User",
                UserEmail = subjectEmail,
                UserRole = Roles.Employee,
                Timestamp = now,
            });
            await db.SaveChangesAsync();
        }

        var export = await (await adminClient.GetAsync($"/gdpr/access?userId={subjectId}"))
            .Content.ReadFromJsonAsync<JsonElement>();

        AssertLinkedByAddress(export, "SurveyInvitation", surveyInvitationId, "Email");
        AssertLinkedByAddress(export, "MicroclimateInvitation", microclimateInvitationId, "Email");
        AssertLinkedByAddress(export, "SurveyAuditLog", auditId, "UserEmail");

        // The account itself is reached by id; users.email is uniquely indexed, so the declared
        // Email link can only ever resolve to the same row and the export says so.
        Assert.Equal(
            "Id",
            Section(export, "User").GetProperty("records").EnumerateArray()
                .First().GetProperty(SubjectAccessExport.LinkKey).GetString());

        Assert.Equal(
            HttpStatusCode.OK,
            (await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true))).StatusCode);

        await using var verify = NewContext();
        Assert.Equal(
            SubjectErasure.RedactedValue,
            (await verify.SurveyInvitations.SingleAsync(i => i.Id == surveyInvitationId)).Email);
        Assert.Equal(
            SubjectErasure.RedactedValue,
            (await verify.MicroclimateInvitations.SingleAsync(i => i.Id == microclimateInvitationId)).Email);
        // survey_audit_logs is DELETED rather than redacted, so the row the address reached is
        // gone entirely. Asserted as absence, which is the stronger statement of the two.
        Assert.False(await verify.SurveyAuditLogs.AnyAsync(a => a.Id == auditId));
    }

    private static void AssertLinkedByAddress(JsonElement export, string entity, Guid id, string linkProperty)
    {
        var record = Section(export, entity).GetProperty("records").EnumerateArray()
            .SingleOrDefault(r => r.TryGetProperty("Id", out var value) && value.GetGuid() == id);

        Assert.True(
            record.ValueKind == JsonValueKind.Object,
            $"{entity} row {id} carries the subject's address and was not exported at all, so the "
            + $"'{linkProperty}' link the map declares for it is searched by nothing.");
        Assert.Equal(linkProperty, record.GetProperty(SubjectAccessExport.LinkKey).GetString());
    }

    [Fact]
    public async Task An_erased_account_can_neither_log_in_nor_refresh()
    {
        var (subjectClient, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);

        // The subject's token works before the erasure, so a refusal afterwards is the
        // erasure's doing and not a token that was never valid.
        Assert.Equal(HttpStatusCode.OK, (await subjectClient.PostAsync("/auth/refresh", content: null)).StatusCode);

        Assert.Equal(
            HttpStatusCode.OK,
            (await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true))).StatusCode);

        // No new token can be minted for the account: the password path cannot find it under
        // the old address, and the refresh 401s during authentication -- erasure rotated the
        // stamp, so SecurityStampValidation refuses the old token before #280's mint-time
        // check (which remains as the backstop) is ever reached.
        var login = await _factory.CreateClient()
            .PostAsJsonAsync("/auth/login", new LoginRequest(subjectEmail, "A-good-passw0rd"));
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await subjectClient.PostAsync("/auth/refresh", content: null)).StatusCode);

        // Neither refusal is about the token already in the subject's hand; that one is
        // An_erasure_ends_the_session_the_subject_is_already_holding's fact. What survives the
        // erasure is the same token presented to the tracking service, which validates the
        // shared secret and consults no stamp -- stated in the response rather than left for a
        // regulator to find.
        Assert.Contains(
            SubjectErasure.KnownLimitations,
            limitation => limitation.Contains("does not consult the stamp", StringComparison.Ordinal));
    }

    /// <summary>
    /// #286: the access token the subject was holding when they exercised their right to
    /// erasure stops working, instead of outliving the erasure by up to the token's 24 hours.
    /// </summary>
    /// <remarks>
    /// <c>GET /profile</c> and not <c>/auth/refresh</c>, and the difference is the whole fact.
    /// Refresh is refused after any erasure by <c>IssueTokenForAsync</c>'s mint-time
    /// deactivation check (#280) whether the stamp rotated or not, so a fact worded against it
    /// passes with the rotation removed and proves nothing. <c>/profile</c> reads no
    /// <c>is_active</c> — before the rotation it answered 200 for an erased subject's
    /// pre-erasure token — so the 401 here is the rotation and nothing else.
    /// </remarks>
    [Fact]
    public async Task An_erasure_ends_the_session_the_subject_is_already_holding()
    {
        var (subjectClient, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);

        // Live before the erasure, so the 401 below cannot be a token that never worked.
        Assert.Equal(HttpStatusCode.OK, (await subjectClient.GetAsync("/profile")).StatusCode);

        Assert.Equal(
            HttpStatusCode.OK,
            (await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true))).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await subjectClient.GetAsync("/profile")).StatusCode);

        // The administrator who ran the erasure is not signed out by it: the rotation is per
        // subject, and an erasure that logged the operator out mid-task would be its own bug.
        Assert.Equal(HttpStatusCode.OK, (await adminClient.GetAsync("/profile")).StatusCode);
    }

    private static JsonElement Section(JsonElement export, string entity)
        => export.GetProperty("sections").EnumerateArray()
            .Single(s => s.GetProperty("entity").GetString() == entity);

    [Fact]
    public async Task Access_export_has_exactly_one_section_per_table_the_map_says_is_exported()
    {
        var (client, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (_, authorId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, authorId);

        var response = await client.GetAsync("/gdpr/access");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var export = await response.Content.ReadFromJsonAsync<JsonElement>();

        var expected = SubjectDataMap.Entries
            .Where(e => e.Export != ExportTreatment.None)
            .Select(e => e.Entity)
            .OrderBy(e => e, StringComparer.Ordinal)
            .ToList();

        var actual = export.GetProperty("sections").EnumerateArray()
            .Select(s => s.GetProperty("entity").GetString()!)
            .OrderBy(e => e, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(expected, actual);
    }

    [Fact]
    public async Task Access_export_returns_the_subjects_own_rows_from_every_kind_of_table()
    {
        var (client, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (_, authorId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, authorId);

        var export = await (await client.GetAsync("/gdpr/access")).Content.ReadFromJsonAsync<JsonElement>();

        // The account, with its owned columns flattened in.
        var user = Section(export, "User").GetProperty("records").EnumerateArray().First();
        Assert.Equal(subjectEmail, user.GetProperty("Email").GetString());
        Assert.Equal("UTC", user.GetProperty("Preferences.Timezone").GetString());
        Assert.True(user.GetProperty("Consent.Essential").GetBoolean());
        Assert.True(user.GetProperty("Notifications.EmailSurveys").GetBoolean());

        // A row keyed by user id, a child row reached through it, and a row addressed by email.
        Assert.Equal(1, Section(export, "Response").GetProperty("recordCount").GetInt32());
        Assert.Equal(
            "my honest opinion",
            Section(export, "QuestionResponse").GetProperty("records").EnumerateArray()
                .Single().GetProperty("ResponseText").GetString());
        Assert.Equal(1, Section(export, "ResponseDemographic").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "UserDemographic").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "UserInvitation").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "UserInvitationDemographic").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "Notification").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "SurveyDraft").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "AuditLog").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "SurveyAuditLog").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "DemographicSnapshotEntry").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "SurveyInvitation").GetProperty("recordCount").GetInt32());
        Assert.Equal(1, Section(export, "MicroclimateInvitation").GetProperty("recordCount").GetInt32());
    }

    [Fact]
    public async Task Access_export_never_returns_another_persons_answers()
    {
        var (client, subjectId, subjectEmail) = await SignInAsync(Roles.CompanyAdmin);
        var seeded = await SeedSubjectDataAsync(subjectId, subjectEmail, subjectId);

        var raw = await (await client.GetAsync("/gdpr/access")).Content.ReadAsStringAsync();

        // The subject authored the survey, so it appears -- as a reference. Its other
        // respondent's answer must not be anywhere in the payload, at any depth.
        Assert.Contains(seeded.SurveyId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("colleague-secret-opinion", raw, StringComparison.Ordinal);
        Assert.DoesNotContain(seeded.OtherResponseId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Access_export_redacts_credentials_but_still_discloses_the_column()
    {
        var (client, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (_, authorId, _) = await SignInAsync(Roles.CompanyAdmin);
        var seeded = await SeedSubjectDataAsync(subjectId, subjectEmail, authorId);

        var response = await client.GetAsync("/gdpr/access");
        var raw = await response.Content.ReadAsStringAsync();
        var export = JsonSerializer.Deserialize<JsonElement>(raw);

        var user = Section(export, "User").GetProperty("records").EnumerateArray().First();
        Assert.Equal(SubjectDataMap.RedactedMarker, user.GetProperty("PasswordHash").GetString());

        var invitation = Section(export, "SurveyInvitation").GetProperty("records").EnumerateArray().Single();
        Assert.Equal(SubjectDataMap.RedactedMarker, invitation.GetProperty("InvitationToken").GetString());

        // The literal token must not survive anywhere in the payload: it is a bearer
        // credential, and an export is a file people email to each other.
        Assert.DoesNotContain(seeded.SurveyInvitationToken, raw, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Access_export_says_it_is_incomplete_and_names_the_database_it_could_not_read()
    {
        var (client, _, _) = await SignInAsync(Roles.Employee);

        var export = await (await client.GetAsync("/gdpr/access")).Content.ReadFromJsonAsync<JsonElement>();

        Assert.False(export.GetProperty("complete").GetBoolean());

        var sources = export.GetProperty("sources").EnumerateArray().ToList();
        var tracking = sources.Single(s => s.GetProperty("name").GetString() == SubjectDataSources.TrackingDatabaseName);
        Assert.False(tracking.GetProperty("included").GetBoolean());
        Assert.Contains("NOT INCLUDED", tracking.GetProperty("detail").GetString()!, StringComparison.Ordinal);

        var primary = sources.Single(s => s.GetProperty("name").GetString() == SubjectDataSources.PrimaryDatabaseName);
        Assert.True(primary.GetProperty("included").GetBoolean());
    }

    [Fact]
    public async Task Every_exported_record_names_a_link_property_the_map_declares()
    {
        var (client, subjectId, subjectEmail) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, subjectId);

        var export = await (await client.GetAsync("/gdpr/access")).Content.ReadFromJsonAsync<JsonElement>();

        foreach (var section in export.GetProperty("sections").EnumerateArray())
        {
            var entity = section.GetProperty("entity").GetString()!;
            var declared = SubjectDataMap.Find(entity)!.LinkProperties;

            foreach (var record in section.GetProperty("records").EnumerateArray())
            {
                var link = record.GetProperty(SubjectAccessExport.LinkKey).GetString();
                Assert.True(
                    declared.Contains(link!, StringComparer.Ordinal),
                    $"{entity} exported a record linked by '{link}', which is not one of the link properties "
                    + $"the map declares ({string.Join(", ", declared)}). Either the export is matching on "
                    + "something undeclared or the map is out of date.");
            }
        }
    }

    [Fact]
    public async Task A_colleague_cannot_read_someone_elses_export_and_an_admin_cannot_reach_another_tenant()
    {
        var (subjectClient, subjectId, _) = await SignInAsync(Roles.Employee);
        var (peerClient, _, _) = await SignInAsync(Roles.Employee);
        var (foreignAdminClient, _, _) = await SignInAsync(
            Roles.CompanyAdmin, _otherCompanyId, _otherDomain);
        var (ownAdminClient, _, _) = await SignInAsync(Roles.CompanyAdmin);

        Assert.Equal(HttpStatusCode.OK, (await subjectClient.GetAsync($"/gdpr/access?userId={subjectId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await peerClient.GetAsync($"/gdpr/access?userId={subjectId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await foreignAdminClient.GetAsync($"/gdpr/access?userId={subjectId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownAdminClient.GetAsync($"/gdpr/access?userId={subjectId}")).StatusCode);
    }

    [Fact]
    public async Task Erasure_deletes_redacts_anonymises_and_retains_exactly_what_the_map_declares()
    {
        var (_, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        var seeded = await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);

        var response = await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var db = NewContext();

        // Anonymised: the account survives as a pseudonym.
        var erased = await db.Users.SingleAsync(u => u.Id == subjectId);
        Assert.Equal(SubjectErasure.PseudonymisedEmail(subjectId), erased.Email);
        Assert.Equal(SubjectErasure.ErasedName, erased.Name);
        Assert.Null(erased.PasswordHash);
        Assert.False(erased.IsActive);
        Assert.False(erased.Consent.Marketing);
        Assert.Equal(_companyId, erased.CompanyId);

        // Anonymised: the answers survive, the envelope does not.
        var answer = await db.Responses.SingleAsync(r => r.Id == seeded.ResponseId);
        Assert.Null(answer.UserId);
        Assert.Null(answer.IpAddress);
        Assert.Null(answer.UserAgent);
        Assert.StartsWith("erased-", answer.SessionId, StringComparison.Ordinal);
        Assert.Equal(1, await db.QuestionResponses.CountAsync(q => q.ResponseId == seeded.ResponseId));
        Assert.Equal(1, await db.ResponseDemographics.CountAsync(d => d.ResponseId == seeded.ResponseId));

        // Deleted.
        Assert.Equal(0, await db.UserDemographics.CountAsync(d => d.UserId == subjectId));
        Assert.Equal(0, await db.Notifications.CountAsync(n => n.UserId == subjectId));
        Assert.Equal(0, await db.SurveyDrafts.CountAsync(d => d.UserId == subjectId));

        // Redacted: the row stays, the identifiers do not.
        var surveyInvitation = await db.SurveyInvitations.SingleAsync(i => i.UserId == subjectId);
        Assert.Equal(SubjectErasure.RedactedValue, surveyInvitation.Email);
        Assert.NotEqual(seeded.SurveyInvitationToken, surveyInvitation.InvitationToken);
        Assert.Equal(SubjectErasure.RedactedValue,
            (await db.MicroclimateInvitations.SingleAsync(i => i.UserId == subjectId)).Email);
        Assert.Equal(0, await db.UserInvitations.CountAsync(i => i.Email == subjectEmail));

        // Retained: the audit trail, intact and still attributable.
        var audit = await db.AuditLogs.SingleAsync(a => a.UserId == subjectId && a.Action == "login");
        Assert.Equal("203.0.113.9", audit.IpAddress);

        // survey_audit_logs is DELETED, not redacted -- the decided treatment. The cost is
        // asserted here rather than left to prose: the subject's rows in the per-survey change
        // history are gone, so that history no longer records that those changes were made.
        // audit_logs above is what survives, still attributable by user_id.
        Assert.False(await db.SurveyAuditLogs.AnyAsync(a => a.UserId == subjectId));

        // Retained: the historical snapshot the employer has already reported on.
        Assert.Equal(1, await db.DemographicSnapshotEntries.CountAsync(e => e.UserId == subjectId));
    }

    /// <summary>
    /// The account row's org placement — <c>department_id</c> and <c>manager_id</c> — is gone
    /// afterwards.
    /// </summary>
    /// <remarks>
    /// <para>Split out from the test above rather than folded into it because it needs a
    /// subject who <b>has</b> a department and a manager, and the shared seed deliberately does
    /// not give one: every other assertion there is about tables reached by user id or by
    /// address, and adding an org placement to that fixture would change what the export
    /// sections contain.</para>
    ///
    /// <para>Why it is asserted at all: <c>SubjectErasure.AnonymiseAccount</c> clears both
    /// columns, the privacy page tells the subject so in as many words
    /// (<c>privacy.erasureAnonymisedUsers</c>: "your department and manager are cleared"), and
    /// until this test both assignments could be deleted with the whole suite green — the
    /// pseudonymised email and the deactivation were asserted, these two were not. "Worked in
    /// this team, reported to this person" is a fact about the individual, and a promise about
    /// it on a page whose only value is that it can be believed needs a test that reads the
    /// columns back.</para>
    ///
    /// <para>The pre-condition is asserted before the erasure runs, because the failure mode
    /// this guards against is a vacuous pass: <c>Assert.Null</c> on a column that was null all
    /// along proves nothing about the code under test.</para>
    /// </remarks>
    [Fact]
    public async Task Erasure_clears_the_department_and_the_manager_the_page_says_it_clears()
    {
        var (_, subjectId, _) = await SignInAsync(Roles.Employee);
        var (adminClient, _, _) = await SignInAsync(Roles.CompanyAdmin);
        var (_, managerId, _) = await SignInAsync(Roles.Supervisor);

        var now = DateTimeOffset.UtcNow;
        await using (var seed = NewContext())
        {
            var department = new Department
            {
                Id = Guid.NewGuid(),
                CompanyId = _companyId,
                Name = $"Engineering {Guid.NewGuid():N}",
                CreatedAt = now,
                UpdatedAt = now,
            };
            seed.Departments.Add(department);

            var subject = await seed.Users.SingleAsync(u => u.Id == subjectId);
            subject.DepartmentId = department.Id;
            subject.ManagerId = managerId;
            await seed.SaveChangesAsync();
        }

        await using (var before = NewContext())
        {
            var placed = await before.Users.SingleAsync(u => u.Id == subjectId);
            Assert.NotNull(placed.DepartmentId);
            Assert.NotNull(placed.ManagerId);
        }

        var response = await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var db = NewContext();
        var erased = await db.Users.SingleAsync(u => u.Id == subjectId);
        Assert.Null(erased.DepartmentId);
        Assert.Null(erased.ManagerId);

        // The manager's own row is somebody else's data and is not touched by this erasure.
        Assert.NotNull(await db.Users.SingleOrDefaultAsync(u => u.Id == managerId && u.IsActive));
    }

    /// <summary>
    /// After an erasure, the subject's own address survives in no column of any table.
    /// </summary>
    /// <remarks>
    /// <para>This stands where a "no dangling foreign keys" sweep used to. That sweep could not
    /// fail: every key it counted is an enforced Postgres constraint, so its answer is zero
    /// whatever the erasure does — a run with <c>SubjectErasure.EraseAsync</c> gutted to a
    /// no-op passed it. It proved the migration matches the model, which is worth knowing and
    /// is not this issue's claim. No orphan can be created here because the database refuses
    /// one, and that is now said in <c>SubjectErasure</c>'s own remarks rather than attributed
    /// to a test.</para>
    ///
    /// <para>What this asserts, only the code under test can make true. The seed puts the
    /// address in five tables through five different treatments — pseudonymised on
    /// <c>users</c>, redacted on <c>survey_invitations</c>, <c>microclimate_invitations</c> and
    /// <c>user_invitations</c>, overwritten on <c>survey_audit_logs</c> — and the scan is
    /// derived from <c>db.Model</c> rather than from that list, so a new table that copies an
    /// address is checked without anyone editing this test. The pre-condition is asserted
    /// first: a green run cannot mean "there was nothing to erase".</para>
    /// </remarks>
    [Fact]
    public async Task Erasure_leaves_the_subjects_address_in_no_column_of_any_table()
    {
        var (_, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);

        await using (var before = NewContext())
        {
            var seeded = await TablesHoldingAsync(before, subjectEmail);
            foreach (var table in new[]
                     {
                         "users", "survey_invitations", "microclimate_invitations", "user_invitations",
                         "survey_audit_logs",
                     })
            {
                Assert.True(
                    seeded.Contains(table, StringComparer.Ordinal),
                    $"The seed never put the subject's address in {table}, so this test would pass without "
                    + "erasure doing anything. Found it in: " + string.Join(", ", seeded));
            }
        }

        var response = await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var db = NewContext();
        var remaining = await TablesHoldingAsync(db, subjectEmail);

        Assert.True(
            remaining.Count == 0,
            "The erased subject's email address is still readable in: " + string.Join(", ", remaining)
            + ". Either the erasure missed a table or a new column now copies the address.");
    }

    /// <summary>
    /// Every table with at least one row in which <paramref name="needle"/> appears, in any
    /// column that renders as text.
    /// </summary>
    /// <remarks>
    /// The column list comes from <c>db.Model</c> — string and string-collection properties,
    /// owned types included, since those are columns of their owner's table. One statement per
    /// table rather than one per column, and <c>POSITION</c> rather than <c>LIKE</c> so that no
    /// character in the address is read as a wildcard. The <c>::text</c> cast is what lets one
    /// predicate cover <c>text</c>, <c>jsonb</c> and <c>text[]</c> alike.
    /// </remarks>
    private static async Task<List<string>> TablesHoldingAsync(ClimateProjectDbContext db, string needle)
    {
        var columnsByTable = new SortedDictionary<string, SortedSet<string>>(StringComparer.Ordinal);

        foreach (var entityType in db.Model.GetEntityTypes())
        {
            if (entityType.GetTableName() is not { } table)
            {
                continue;
            }

            foreach (var property in entityType.GetProperties())
            {
                if (property.ClrType != typeof(string)
                    && property.ClrType != typeof(List<string>)
                    && property.ClrType != typeof(string[]))
                {
                    continue;
                }

                if (property.GetColumnName() is not { } column)
                {
                    continue;
                }

                if (!columnsByTable.TryGetValue(table, out var columns))
                {
                    columns = new SortedSet<string>(StringComparer.Ordinal);
                    columnsByTable[table] = columns;
                }

                columns.Add(column);
            }
        }

        var holding = new List<string>();
        foreach (var (table, columns) in columnsByTable)
        {
            var predicate = string.Join(
                " OR ", columns.Select(c => $"POSITION({{0}} IN {Quote(c)}::text) > 0"));
            var sql = $"SELECT COUNT(*)::bigint AS \"Value\" FROM {Quote(table)} WHERE {predicate}";

            if (await db.Database.SqlQueryRaw<long>(sql, needle).SingleAsync() > 0)
            {
                holding.Add(table);
            }
        }

        return holding;
    }

    [Fact]
    public async Task Erasure_refuses_without_confirmation_across_tenants_and_on_the_callers_own_account()
    {
        var (_, subjectId, _) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        var (foreignAdminClient, _, _) = await SignInAsync(Roles.CompanyAdmin, _otherCompanyId, _otherDomain);
        var (employeeClient, _, _) = await SignInAsync(Roles.Employee);

        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, false))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await employeeClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true))).StatusCode);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await foreignAdminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true))).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(adminId, true))).StatusCode);

        // Nothing above touched the subject.
        await using var db = NewContext();
        var untouched = await db.Users.SingleAsync(u => u.Id == subjectId);
        Assert.True(untouched.IsActive);
    }

    [Fact]
    public async Task Compliance_report_has_one_line_per_classified_table_and_stays_inside_the_callers_tenant()
    {
        var (adminClient, _, _) = await SignInAsync(Roles.CompanyAdmin);

        var response = await adminClient.GetAsync("/gdpr/compliance-report");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var report = await response.Content.ReadFromJsonAsync<JsonElement>();

        var entities = report.GetProperty("entries").EnumerateArray()
            .Select(e => e.GetProperty("entity").GetString()!)
            .OrderBy(e => e, StringComparer.Ordinal)
            .ToList();
        Assert.Equal(
            SubjectDataMap.Entries.Select(e => e.Entity).OrderBy(e => e, StringComparer.Ordinal).ToList(),
            entities);

        Assert.Equal(_companyId, report.GetProperty("companyId").GetGuid());
        Assert.Equal(
            SubjectDataMap.Entries.Count(e => e.Link != SubjectLink.None),
            report.GetProperty("tablesHoldingSubjectData").GetInt32());

        // Every line carries a basis and a retention rule -- the report is the artefact a
        // regulator reads, so a blank column in it is the failure.
        foreach (var entry in report.GetProperty("entries").EnumerateArray())
        {
            Assert.False(string.IsNullOrWhiteSpace(entry.GetProperty("lawfulBasis").GetString()));
            Assert.False(string.IsNullOrWhiteSpace(entry.GetProperty("retention").GetString()));
            Assert.False(string.IsNullOrWhiteSpace(entry.GetProperty("rationale").GetString()));
        }

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await adminClient.GetAsync($"/gdpr/compliance-report?companyId={_otherCompanyId}")).StatusCode);
    }

    [Fact]
    public async Task Retention_cleanup_is_super_admin_only_and_runs_the_sweep()
    {
        var (adminClient, _, _) = await SignInAsync(Roles.CompanyAdmin);
        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await adminClient.PostAsync("/gdpr/retention-cleanup", content: null)).StatusCode);

        var (superClient, superId, _) = await SignInAsync(Roles.SuperAdmin);

        await using (var db = NewContext())
        {
            db.SurveyDrafts.Add(new SurveyDraft
            {
                Id = Guid.NewGuid(),
                UserId = superId,
                CompanyId = _companyId,
                SessionId = Guid.NewGuid().ToString("N"),
                DraftData = "{}",
                CurrentStep = 1,
                Version = 1,
                ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1),
                CreatedAt = DateTimeOffset.UtcNow.AddDays(-31),
                UpdatedAt = DateTimeOffset.UtcNow.AddDays(-31),
            });
            await db.SaveChangesAsync();
        }

        var response = await superClient.PostAsync("/gdpr/retention-cleanup", content: null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<JsonElement>();

        var categories = result.GetProperty("categories").EnumerateArray()
            .Select(c => c.GetProperty("category").GetString()!)
            .ToList();
        Assert.Contains(RetentionCleanupJobNames.SurveyDrafts, categories);

        await using var verify = NewContext();
        Assert.Equal(0, await verify.SurveyDrafts.CountAsync(d => d.UserId == superId));
    }

    /// <summary>
    /// All four actions, not three. The name used to promise more than the body checked:
    /// deleting the audit write from <c>RetentionCleanupAsync</c> reddened nothing, and that
    /// is the one action here that deletes rows across every tenant.
    /// </summary>
    [Fact]
    public async Task Every_gdpr_action_writes_an_audit_row_attributed_to_the_caller()
    {
        var (_, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);

        await adminClient.GetAsync($"/gdpr/access?userId={subjectId}");
        await adminClient.GetAsync("/gdpr/compliance-report");
        await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true));

        var (superClient, superId, _) = await SignInAsync(Roles.SuperAdmin);
        Assert.Equal(
            HttpStatusCode.OK,
            (await superClient.PostAsync("/gdpr/retention-cleanup", content: null)).StatusCode);

        await using var db = NewContext();
        var rows = await db.AuditLogs
            .Where(a => a.Resource == GdprEndpoints.AuditResource && a.UserId == adminId)
            .ToListAsync();

        Assert.Contains(rows, r => r.Action == GdprEndpoints.AccessAction && r.ResourceId == subjectId.ToString());
        Assert.Contains(rows, r => r.Action == GdprEndpoints.ComplianceReportAction);

        // The erasure's own audit row must survive the erasure it records.
        Assert.Contains(rows, r => r.Action == GdprEndpoints.ErasureAction && r.ResourceId == subjectId.ToString());

        var sweepRows = await db.AuditLogs
            .Where(a => a.Resource == GdprEndpoints.AuditResource && a.UserId == superId)
            .ToListAsync();
        Assert.Contains(sweepRows, r => r.Action == GdprEndpoints.RetentionCleanupAction);
    }

    /// <summary>
    /// The company-less super admin (#191), which no other test in this class exercises: every
    /// caller here is minted by <see cref="SignInAsync"/>, whose <c>companyId</c> defaults to
    /// the tenant, so the branch that decides whether an audit row can be written at all was
    /// never reached.
    /// </summary>
    /// <remarks>
    /// Three answers, and the difference between them is the fix. An erasure names a subject, so
    /// its row is filed against the subject's tenant and the action is recorded even though the
    /// caller has no company of their own; a compliance report about one tenant is filed against
    /// that tenant. The retention sweep names no tenant and crosses all of them, and neither
    /// does a compliance report about every tenant at once, so there is nothing to file those
    /// against while <c>audit_logs.company_id</c> is NOT NULL — they run unaudited, with a
    /// warning, and that pair is exactly the gap the class docstring states. Widening the column
    /// is a migration, which this issue does not carry.
    /// </remarks>
    [Fact]
    public async Task A_company_less_super_admins_erasure_is_audited_against_the_subjects_tenant()
    {
        var (_, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (_, authorId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, authorId);

        var (superClient, superId, _) = await SignInAsync(Roles.SuperAdmin);
        await using (var db = NewContext())
        {
            var super = await db.Users.SingleAsync(u => u.Id == superId);
            super.CompanyId = null;
            await db.SaveChangesAsync();
        }

        Assert.Equal(
            HttpStatusCode.OK,
            (await superClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true))).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await superClient.GetAsync($"/gdpr/compliance-report?companyId={_companyId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await superClient.GetAsync("/gdpr/compliance-report")).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await superClient.PostAsync("/gdpr/retention-cleanup", content: null)).StatusCode);

        await using var verify = NewContext();
        var rows = await verify.AuditLogs
            .Where(a => a.Resource == GdprEndpoints.AuditResource && a.UserId == superId)
            .ToListAsync();

        var erasure = rows.Single(r => r.Action == GdprEndpoints.ErasureAction);
        Assert.Equal(subjectId.ToString(), erasure.ResourceId);
        Assert.Equal(_companyId, erasure.CompanyId);

        var report = rows.Single(r => r.Action == GdprEndpoints.ComplianceReportAction);
        Assert.Equal(_companyId.ToString(), report.ResourceId);
        Assert.Equal(_companyId, report.CompanyId);

        // The two that name no tenant, with no company on the caller either: the documented gap,
        // and the whole of it.
        Assert.DoesNotContain(rows, r => r.Action == GdprEndpoints.RetentionCleanupAction);
        Assert.DoesNotContain(
            rows, r => r.Action == GdprEndpoints.ComplianceReportAction && r.ResourceId is null);
    }

    private static string Quote(string identifier)
        => '"' + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + '"';

    /// <summary>Category names, so the assertion above cannot drift from the job.</summary>
    private static class RetentionCleanupJobNames
    {
        public const string SurveyDrafts = ClimateProject.Infrastructure.Scheduling.RetentionCleanupJob.SurveyDraftsCategory;
    }
}
