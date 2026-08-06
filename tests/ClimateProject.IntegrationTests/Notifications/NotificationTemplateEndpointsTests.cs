using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Notifications;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Notifications;

/// <summary>
/// #96. Two properties beyond ordinary CRUD are load-bearing here and each has its own
/// test:
///
/// 1. A global template (<c>CompanyId == null</c>) is readable by every tenant, so it is
///    SuperAdmin-only to write -- the rule Benchmark already applies. The notifications
///    plan's own sketch reused one authorization helper for read and write and would
///    have let a CompanyAdmin edit the emails every other tenant sends.
/// 2. A personalization-rule condition is never code. An injection string is rejected on
///    write with a 400, and even a stored one would evaluate to false rather than run.
/// </summary>
[Collection("Postgres")]
public class NotificationTemplateEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyADomain = $"notifa-{Guid.NewGuid():N}.test";
    private readonly string _companyBDomain = $"notifb-{Guid.NewGuid():N}.test";
    private readonly string _companyEsDomain = $"notifes-{Guid.NewGuid():N}.test";
    private Guid _companyAId;
    private Guid _companyBId;
    private Guid _companyEsId;

    public NotificationTemplateEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var companyA = new Company { Id = Guid.NewGuid(), Name = "Notif Co A", EmailDomain = _companyADomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyB = new Company { Id = Guid.NewGuid(), Name = "Notif Co B", EmailDomain = _companyBDomain, CreatedAt = DateTimeOffset.UtcNow };
        var companyEs = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Notif Co ES",
            EmailDomain = _companyEsDomain,
            CreatedAt = DateTimeOffset.UtcNow,
            Settings = new CompanySettings { Language = ContentLanguages.Spanish },
        };

        db.Companies.AddRange(companyA, companyB, companyEs);
        _companyAId = companyA.Id;
        _companyBId = companyB.Id;
        _companyEsId = companyEs.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> ClientAsync(string role, string emailDomain, Guid? companyId = null)
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{emailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        signup.EnsureSuccessStatusCode();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            if (companyId.HasValue)
            {
                user.CompanyId = companyId.Value;
            }
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        var token = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static LocalizedInput Bilingual(string en, string es)
        => LocalizedInput.FromLocales(new Dictionary<string, string?>
        {
            [ContentLanguages.English] = en,
            [ContentLanguages.Spanish] = es,
        });

    private static CreateNotificationTemplateRequest CompanyTemplate(
        string name,
        Guid companyId,
        IReadOnlyList<NotificationTemplateVariableInput>? variables = null,
        IReadOnlyList<NotificationPersonalizationRuleInput>? rules = null,
        string channel = "email",
        bool isActive = true)
        => new(
            name,
            "survey_reminder",
            channel,
            LocalizedInput.FromBare("Reminder"),
            LocalizedInput.FromBare("Survey reminder"),
            LocalizedInput.FromBare("Hello {{userName}}"),
            LocalizedInput.FromBare("<p>Hello {{userName}}</p>"),
            companyId,
            IsDefault: false,
            variables,
            rules,
            isActive);

    private static CreateNotificationTemplateRequest GlobalTemplate(
        string name,
        IReadOnlyList<NotificationPersonalizationRuleInput>? rules = null)
        => new(
            name,
            "survey_reminder",
            "email",
            Bilingual("Reminder", "Recordatorio"),
            Bilingual("Survey reminder", "Recordatorio de encuesta"),
            Bilingual("Hello {{userName}}", "Hola {{userName}}"),
            Bilingual("<p>Hello {{userName}}</p>", "<p>Hola {{userName}}</p>"),
            CompanyId: null,
            IsDefault: false,
            Variables: null,
            Rules: rules);

    // ---------------------------------------------------------------- CRUD

    [Fact]
    public async Task Company_admin_creates_reads_and_updates_a_template_in_their_own_company()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var createResponse = await client.PostAsJsonAsync("/notification-templates", CompanyTemplate("Weekly reminder", _companyAId));
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        Assert.Equal("Weekly reminder", created!.Name);
        Assert.Equal(_companyAId, created.CompanyId);
        Assert.Equal("Survey reminder", created.Title);
        Assert.True(created.IsActive);
        // Company A has the default 'en' language, so a bare string is attributed there.
        Assert.Equal(ContentLanguages.English, created.ContentLanguage);
        Assert.Empty(created.FallbackFields);

        var getResponse = await client.GetAsync($"/notification-templates/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);

        var updateResponse = await client.PutAsJsonAsync(
            $"/notification-templates/{created.Id}",
            new UpdateNotificationTemplateRequest("Renamed", null, null, null, null, null, null, null));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updated = await updateResponse.Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        Assert.Equal("Renamed", updated!.Name);
        // Omitted localized fields are left alone, not blanked.
        Assert.Equal("Survey reminder", updated.Title);
        Assert.Equal("Hello {{userName}}", updated.Content);
    }

    [Fact]
    public async Task Read_DTOs_never_expose_En_or_Es_shaped_fields()
    {
        // The #195 constraint that keeps a third language a migration rather than a
        // frontend rewrite. Asserted on the wire, not on the record type, because it is
        // the JSON that every consumer is coupled to.
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var created = await (await client.PostAsJsonAsync("/notification-templates", CompanyTemplate("Wire shape", _companyAId)))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var json = await (await client.GetAsync($"/notification-templates/{created!.Id}")).Content.ReadAsStringAsync();

        Assert.DoesNotContain("subjectEn", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("subjectEs", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("titleEn", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("contentEs", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("htmlContentEn", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_spanish_company_attributes_a_bare_string_to_spanish_and_serves_it_back()
    {
        var client = await ClientAsync(Roles.CompanyAdmin, _companyEsDomain, _companyEsId);

        var created = await (await client.PostAsJsonAsync("/notification-templates", CompanyTemplate("Recordatorio", _companyEsId)))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        Assert.Equal(ContentLanguages.Spanish, created!.ContentLanguage);
        Assert.Equal(ContentLanguages.Spanish, created.ResolvedLocale);

        // Asking for English gets the Spanish text back *and says so*, rather than
        // silently serving a language nobody authored.
        var english = await (await client.GetAsync($"/notification-templates/{created.Id}?lang=en"))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        Assert.Equal(ContentLanguages.English, english!.ResolvedLocale);
        Assert.Equal("Survey reminder", english.Title);
        Assert.Contains("title", english.FallbackFields);
    }

    [Fact]
    public async Task A_global_template_is_served_in_the_locale_asked_for()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var created = await (await client.PostAsJsonAsync("/notification-templates", GlobalTemplate("Global reminder")))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        Assert.Equal(ContentLanguages.Both, created!.ContentLanguage);

        var spanish = await (await client.GetAsync($"/notification-templates/{created.Id}?lang=es-CO"))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        Assert.Equal(ContentLanguages.Spanish, spanish!.ResolvedLocale);
        Assert.Equal("Recordatorio de encuesta", spanish.Title);
        Assert.Empty(spanish.FallbackFields);
    }

    [Fact]
    public async Task A_bare_string_is_rejected_for_a_global_template_rather_than_filed_as_english()
    {
        // A global template is read by tenants in both languages, so it is authored in
        // 'both' and there is no language to attribute an unlabelled string to. Guessing
        // is how Spanish text ends up in the English column.
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var response = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            "Ambiguous", "survey_reminder", "email",
            LocalizedInput.FromBare("Recordatorio"),
            Bilingual("Survey reminder", "Recordatorio de encuesta"),
            Bilingual("Hello", "Hola"),
            null, null, false, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("subject", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_active_global_template_must_be_authored_in_both_languages()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var response = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            "Half translated", "survey_reminder", "email",
            Bilingual("Reminder", "Recordatorio"),
            LocalizedInput.FromLocales(new Dictionary<string, string?> { [ContentLanguages.English] = "Survey reminder" }),
            Bilingual("Hello", "Hola"),
            null, null, false, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("title (es)", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_inactive_template_may_be_saved_half_translated()
    {
        // The gate is on activation, not on save -- an editor has to be able to store one
        // language while the other is still being written.
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var response = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            "Draft", "survey_reminder", "email",
            Bilingual("Reminder", "Recordatorio"),
            LocalizedInput.FromLocales(new Dictionary<string, string?> { [ContentLanguages.English] = "Survey reminder" }),
            Bilingual("Hello", "Hola"),
            null, null, false, null, null, IsActive: false));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<NotificationTemplateDetail>();
        Assert.False(created!.IsActive);

        // ...and activating it is where the missing translation is caught.
        var activate = await client.PutAsJsonAsync(
            $"/notification-templates/{created.Id}",
            new UpdateNotificationTemplateRequest(null, null, null, null, null, true, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, activate.StatusCode);
    }

    // ------------------------------------------------------- authorization

    [Fact]
    public async Task A_company_admin_may_read_a_global_template_but_not_write_one()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        var global = await (await superAdmin.PostAsJsonAsync("/notification-templates", GlobalTemplate("Shared reminder")))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var companyAdmin = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);

        var read = await companyAdmin.GetAsync($"/notification-templates/{global!.Id}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);

        // The regression this test exists for: a global template is visible to every
        // tenant, so a CompanyAdmin write would change what every other tenant sends.
        var write = await companyAdmin.PutAsJsonAsync(
            $"/notification-templates/{global.Id}",
            new UpdateNotificationTemplateRequest("Hijacked", null, null, null, null, null, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);

        var create = await companyAdmin.PostAsJsonAsync("/notification-templates", GlobalTemplate("Sneaky global"));
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
    }

    [Fact]
    public async Task A_company_admin_cannot_touch_another_companys_template()
    {
        var adminA = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var created = await (await adminA.PostAsJsonAsync("/notification-templates", CompanyTemplate("A only", _companyAId)))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var adminB = await ClientAsync(Roles.CompanyAdmin, _companyBDomain, _companyBId);

        Assert.Equal(HttpStatusCode.Forbidden, (await adminB.GetAsync($"/notification-templates/{created!.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await adminB.PutAsJsonAsync(
            $"/notification-templates/{created.Id}",
            new UpdateNotificationTemplateRequest("Nope", null, null, null, null, null, null, null))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await adminB.PostAsJsonAsync(
            "/notification-templates", CompanyTemplate("Cross tenant", _companyAId))).StatusCode);
    }

    [Fact]
    public async Task A_non_admin_gets_nothing()
    {
        var employee = await ClientAsync(Roles.Employee, _companyADomain, _companyAId);

        Assert.Equal(HttpStatusCode.Forbidden, (await employee.GetAsync("/notification-templates")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.PostAsJsonAsync(
            "/notification-templates", CompanyTemplate("Employee made", _companyAId))).StatusCode);
    }

    [Fact]
    public async Task Listing_shows_a_company_admin_their_own_templates_and_the_global_ones_only()
    {
        var superAdmin = await ClientAsync(Roles.SuperAdmin, _companyADomain);
        await superAdmin.PostAsJsonAsync("/notification-templates", GlobalTemplate($"Global {Guid.NewGuid():N}"));

        var adminA = await ClientAsync(Roles.CompanyAdmin, _companyADomain, _companyAId);
        var mine = await (await adminA.PostAsJsonAsync("/notification-templates", CompanyTemplate($"Mine {Guid.NewGuid():N}", _companyAId)))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var adminB = await ClientAsync(Roles.CompanyAdmin, _companyBDomain, _companyBId);
        var theirs = await (await adminB.PostAsJsonAsync("/notification-templates", CompanyTemplate($"Theirs {Guid.NewGuid():N}", _companyBId)))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var listed = await (await adminA.GetAsync("/notification-templates"))
            .Content.ReadFromJsonAsync<NotificationTemplateListResponse>();

        Assert.Contains(listed!.Templates, t => t.Id == mine!.Id);
        Assert.Contains(listed.Templates, t => t.CompanyId is null);
        Assert.DoesNotContain(listed.Templates, t => t.Id == theirs!.Id);
    }

    // --------------------------------------------------- conditions (#73)

    [Theory]
    [InlineData("reminderCount >= 3 && process.exit(1)")]
    [InlineData("reminderCount.constructor.constructor('return 1')()")]
    [InlineData("(function(){return true})()")]
    [InlineData("1; require('child_process').execSync('id')")]
    [InlineData("__proto__.polluted = 1")]
    public async Task A_code_injection_condition_is_rejected_on_write_not_executed(string condition)
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var response = await client.PostAsJsonAsync("/notification-templates", CompanyTemplate(
            $"Injection {Guid.NewGuid():N}",
            _companyAId,
            rules: [new NotificationPersonalizationRuleInput(condition, null)]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("condition", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

        // Rejected means *not stored*, so nothing downstream can ever reach it.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.False(await db.NotificationPersonalizationRules.AnyAsync(r => r.Condition == condition));
    }

    [Fact]
    public async Task A_supported_condition_round_trips_and_drives_the_preview()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var created = await (await client.PostAsJsonAsync("/notification-templates", CompanyTemplate(
            "Escalating reminder",
            _companyAId,
            variables: [new NotificationTemplateVariableInput("reminderCount", "number", true, "How many reminders were sent", "0")],
            rules: [new NotificationPersonalizationRuleInput("reminderCount >= 3", "{\"tone\":\"urgent\"}")])))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var rule = Assert.Single(created!.Rules);
        Assert.Equal("reminderCount >= 3", rule.Condition);

        var matched = await (await client.PostAsJsonAsync($"/notification-templates/{created.Id}/preview",
            new NotificationTemplatePreviewRequest(new Dictionary<string, string?> { ["reminderCount"] = "5" }, null)))
            .Content.ReadFromJsonAsync<NotificationTemplatePreview>();
        Assert.Equal(rule.Id, Assert.Single(matched!.MatchedRuleIds));

        var unmatched = await (await client.PostAsJsonAsync($"/notification-templates/{created.Id}/preview",
            new NotificationTemplatePreviewRequest(new Dictionary<string, string?> { ["reminderCount"] = "1" }, null)))
            .Content.ReadFromJsonAsync<NotificationTemplatePreview>();
        Assert.Empty(unmatched!.MatchedRuleIds);
    }

    // ------------------------------------------------------------ preview

    [Fact]
    public async Task Preview_substitutes_variables_and_escapes_them_in_the_html_body()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var created = await (await client.PostAsJsonAsync("/notification-templates", CompanyTemplate(
            "Escaping",
            _companyAId,
            variables: [new NotificationTemplateVariableInput("userName", "string", true, "Recipient name", "\"Equipo\"")])))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var preview = await (await client.PostAsJsonAsync($"/notification-templates/{created!.Id}/preview",
            new NotificationTemplatePreviewRequest(
                new Dictionary<string, string?> { ["userName"] = "<script>alert('xss')</script>" },
                null)))
            .Content.ReadFromJsonAsync<NotificationTemplatePreview>();

        Assert.Equal("Hello <script>alert('xss')</script>", preview!.Content);
        Assert.Equal("<p>Hello &lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;</p>", preview.HtmlContent);
        Assert.Empty(preview.MissingRequiredVariables);
    }

    [Fact]
    public async Task Preview_falls_back_to_a_declared_default_and_reports_what_is_still_missing()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var created = await (await client.PostAsJsonAsync("/notification-templates", CompanyTemplate(
            "Defaults",
            _companyAId,
            variables:
            [
                new NotificationTemplateVariableInput("userName", "string", true, "Recipient name", "\"Equipo\""),
                new NotificationTemplateVariableInput("surveyTitle", "string", true, "Survey title", null),
            ])))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var preview = await (await client.PostAsJsonAsync($"/notification-templates/{created!.Id}/preview",
            new NotificationTemplatePreviewRequest(null, null)))
            .Content.ReadFromJsonAsync<NotificationTemplatePreview>();

        // The JSON string default is unwrapped, not rendered with its quotes.
        Assert.Equal("Hello Equipo", preview!.Content);
        Assert.Equal("surveyTitle", Assert.Single(preview.MissingRequiredVariables));
    }

    // --------------------------------------------------------- validation

    [Fact]
    public async Task A_non_json_variable_default_is_a_400_not_a_500()
    {
        // default_value is a jsonb column. Without the write-time check this reaches
        // Postgres as a 22P02 and the admin sees an opaque 500.
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var response = await client.PostAsJsonAsync("/notification-templates", CompanyTemplate(
            "Bad default",
            _companyAId,
            variables: [new NotificationTemplateVariableInput("userName", "string", false, "Recipient name", "Equipo")]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_a_missing_name_type_or_channel_and_an_unsupported_channel()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var blank = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            "  ", "survey_reminder", "email", null, null, null, null, _companyAId, false, null, null, IsActive: false));
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);

        var badChannel = await client.PostAsJsonAsync("/notification-templates", new CreateNotificationTemplateRequest(
            "Carrier pigeon", "survey_reminder", "pigeon", null, null, null, null, _companyAId, false, null, null, IsActive: false));
        Assert.Equal(HttpStatusCode.BadRequest, badChannel.StatusCode);
    }

    [Fact]
    public async Task Rejects_a_company_id_that_does_not_exist()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var response = await client.PostAsJsonAsync("/notification-templates", CompanyTemplate("Orphan", Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_duplicate_variable_names()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var response = await client.PostAsJsonAsync("/notification-templates", CompanyTemplate(
            "Duplicated",
            _companyAId,
            variables:
            [
                new NotificationTemplateVariableInput("userName", "string", false, "One", null),
                new NotificationTemplateVariableInput("userName", "string", false, "Two", null),
            ]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Updating_replaces_the_child_rows_wholesale()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var created = await (await client.PostAsJsonAsync("/notification-templates", CompanyTemplate(
            "Replaceable",
            _companyAId,
            variables: [new NotificationTemplateVariableInput("userName", "string", false, "Recipient", null)],
            rules: [new NotificationPersonalizationRuleInput("reminderCount >= 3", null)])))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var updated = await (await client.PutAsJsonAsync(
            $"/notification-templates/{created!.Id}",
            new UpdateNotificationTemplateRequest(
                null, null, null, null, null, null,
                [new NotificationTemplateVariableInput("surveyTitle", "string", false, "Survey", null)],
                [])))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        Assert.Equal("surveyTitle", Assert.Single(updated!.Variables).Name);
        Assert.Empty(updated.Rules);
    }

    [Fact]
    public async Task An_invalid_condition_on_update_leaves_the_existing_rules_untouched()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        var created = await (await client.PostAsJsonAsync("/notification-templates", CompanyTemplate(
            "Guarded update",
            _companyAId,
            rules: [new NotificationPersonalizationRuleInput("reminderCount >= 3", null)])))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        var response = await client.PutAsJsonAsync(
            $"/notification-templates/{created!.Id}",
            new UpdateNotificationTemplateRequest(
                "Renamed", null, null, null, null, null, null,
                [new NotificationPersonalizationRuleInput("(function(){return true})()", null)]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var reread = await (await client.GetAsync($"/notification-templates/{created.Id}"))
            .Content.ReadFromJsonAsync<NotificationTemplateDetail>();

        Assert.Equal("Guarded update", reread!.Name);
        Assert.Equal("reminderCount >= 3", Assert.Single(reread.Rules).Condition);
    }

    [Fact]
    public async Task An_unknown_template_is_a_404()
    {
        var client = await ClientAsync(Roles.SuperAdmin, _companyADomain);

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/notification-templates/{Guid.NewGuid()}")).StatusCode);
    }
}
