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
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
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
        await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));

        Guid userId;
        await using (var db = NewContext())
        {
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = companyId ?? _companyId;
            await db.SaveChangesAsync();
            userId = user.Id;
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
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

        var surveyAudit = await db.SurveyAuditLogs.SingleAsync(a => a.UserId == subjectId);
        Assert.Equal(SubjectErasure.RedactedValue, surveyAudit.UserEmail);
        Assert.Equal(SubjectErasure.ErasedName, surveyAudit.UserName);
        Assert.Equal("updated", surveyAudit.Action);
        Assert.Equal(subjectId, surveyAudit.UserId);

        // Retained: the historical snapshot the employer has already reported on.
        Assert.Equal(1, await db.DemographicSnapshotEntries.CountAsync(e => e.UserId == subjectId));
    }

    /// <summary>
    /// Re-derives every foreign key in the model and checks each one after an erasure.
    /// </summary>
    /// <remarks>
    /// A hand-written list of "tables erasure touches" would only ever check the tables
    /// somebody remembered, which is the same failure mode the subject-data map exists to
    /// prevent. This walks <c>db.Model.GetEntityTypes()</c> instead, so a foreign key added
    /// later is checked without anyone editing this test.
    /// </remarks>
    [Fact]
    public async Task Erasure_leaves_no_orphaned_rows()
    {
        var (_, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);

        await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true));

        await using var db = NewContext();
        var orphans = new List<string>();

        foreach (var entityType in db.Model.GetEntityTypes().Where(t => !t.IsOwned()))
        {
            var table = entityType.GetTableName();
            if (table is null)
            {
                continue;
            }

            foreach (var fk in entityType.GetForeignKeys())
            {
                var principal = fk.PrincipalEntityType;
                var principalTable = principal.GetTableName();
                if (principalTable is null || principalTable == table)
                {
                    continue; // Self-references would need aliasing; users.manager_id is covered below.
                }

                var childColumns = fk.Properties.Select(p => Quote(p.GetColumnName())).ToList();
                var parentColumns = fk.PrincipalKey.Properties.Select(p => Quote(p.GetColumnName())).ToList();
                var join = string.Join(" AND ",
                    childColumns.Zip(parentColumns, (c, p) => $"c.{c} = p.{p}"));
                var notNull = string.Join(" AND ", childColumns.Select(c => $"c.{c} IS NOT NULL"));

                var sql =
                    $"SELECT COUNT(*)::bigint AS \"Value\" FROM {Quote(table)} c "
                    + $"WHERE {notNull} AND NOT EXISTS (SELECT 1 FROM {Quote(principalTable)} p WHERE {join})";

                var dangling = await db.Database.SqlQueryRaw<long>(sql).SingleAsync();
                if (dangling > 0)
                {
                    orphans.Add($"{table}({string.Join(",", childColumns)}) -> {principalTable}: {dangling}");
                }
            }
        }

        // users.manager_id, the one self-reference, checked directly.
        var danglingManagers = await db.Users
            .CountAsync(u => u.ManagerId != null && !db.Users.Any(m => m.Id == u.ManagerId));
        Assert.Equal(0, danglingManagers);

        Assert.True(orphans.Count == 0, "Dangling foreign keys after erasure: " + string.Join("; ", orphans));
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

    [Fact]
    public async Task Every_gdpr_action_writes_an_audit_row_attributed_to_the_caller()
    {
        var (_, subjectId, subjectEmail) = await SignInAsync(Roles.Employee);
        var (adminClient, adminId, _) = await SignInAsync(Roles.CompanyAdmin);
        await SeedSubjectDataAsync(subjectId, subjectEmail, adminId);

        await adminClient.GetAsync($"/gdpr/access?userId={subjectId}");
        await adminClient.GetAsync("/gdpr/compliance-report");
        await adminClient.PostAsJsonAsync("/gdpr/erasure", new ErasureRequest(subjectId, true));

        await using var db = NewContext();
        var rows = await db.AuditLogs
            .Where(a => a.Resource == GdprEndpoints.AuditResource && a.UserId == adminId)
            .ToListAsync();

        Assert.Contains(rows, r => r.Action == GdprEndpoints.AccessAction && r.ResourceId == subjectId.ToString());
        Assert.Contains(rows, r => r.Action == GdprEndpoints.ComplianceReportAction);

        // The erasure's own audit row must survive the erasure it records.
        Assert.Contains(rows, r => r.Action == GdprEndpoints.ErasureAction && r.ResourceId == subjectId.ToString());
    }

    private static string Quote(string identifier)
        => '"' + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + '"';

    /// <summary>Category names, so the assertion above cannot drift from the job.</summary>
    private static class RetentionCleanupJobNames
    {
        public const string SurveyDrafts = ClimateProject.Infrastructure.Scheduling.RetentionCleanupJob.SurveyDraftsCategory;
    }
}
