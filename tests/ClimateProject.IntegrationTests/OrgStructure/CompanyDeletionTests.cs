using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Questions;
using ClimateProject.Application.Surveys;
using ClimateProject.IntegrationTests.Surveys;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// Deleting a company nobody has answered anything in (ruled 2026-11-08). Until this, each one
/// was <c>delete-test-companies.sql</c>: a transitive-closure script a developer ran by hand.
/// </summary>
[Collection("Postgres")]
public class CompanyDeletionTests : IAsyncLifetime
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];

    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _otherCompanyId;

    public CompanyDeletionTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"delete-co-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync($"Borrar {Guid.NewGuid():N}"[..20]);
        _otherCompanyId = await _harness.SeedCompanyAsync("Se queda");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<string> NameAsync(Guid companyId)
        => _harness.WithDbAsync(db => db.Companies.AsNoTracking().Where(c => c.Id == companyId).Select(c => c.Name).SingleAsync());

    private static async Task<HttpResponseMessage> DeleteAsync(HttpClient client, Guid companyId, string? confirmName)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/admin/companies/{companyId}")
        {
            Content = JsonContent.Create(new DeleteCompanyRequest(confirmName)),
        };
        return await client.SendAsync(request);
    }

    /// <summary>
    /// A company with the shapes that tripped the SQL script: people who manage each other,
    /// departments under departments, a survey with invitations and keys, a draft, a
    /// company-owned template and question library, a logo, and the company's own audit rows.
    /// </summary>
    private async Task<(HttpClient Operator, Guid Employee)> FurnishAsync(Guid companyId)
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var (admin, adminId) = await _harness.IdentifiedClientAsync(Roles.CompanyAdmin, companyId);
        var (_, employee) = await _harness.IdentifiedClientAsync(Roles.Employee, companyId);
        await _harness.WithDbAsync(async db =>
        {
            var person = await db.Users.FirstAsync(u => u.Id == employee);
            person.ManagerId = adminId;
            var boss = await db.Users.FirstAsync(u => u.Id == adminId);
            boss.ManagerId = employee;
            await db.SaveChangesAsync();
        });

        var parent = await admin.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(companyId, "Operaciones", null, null, true));
        parent.EnsureSuccessStatusCode();
        var parentId = JsonDocument.Parse(await parent.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();
        (await admin.PostAsJsonAsync("/admin/departments", new CreateDepartmentRequest(companyId, "Bodega", null, parentId, true))).EnsureSuccessStatusCode();

        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(companyId));
        (await SurveyTestHarness.SetStatusAsync(admin, survey.Id, SurveyStatuses.Active)).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"/surveys/{survey.Id}/invitations", new CreateSurveyInvitationsRequest(AllTargeted: true))).EnsureSuccessStatusCode();
        await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(companyId, title: LocalizedInput.FromBare("Borrador")));

        (await admin.PostAsJsonAsync("/survey-templates", new CreateSurveyTemplateRequest(
            LocalizedInput.FromBare($"Plantilla privada {companyId:N}"),
            LocalizedInput.FromBare("Solo de esta empresa"),
            "general_climate",
            CompanyId: companyId,
            Questions: [new CreateSurveyTemplateQuestionInput(LocalizedInput.FromBare("¿Cómo está?"), "open_ended")]))).EnsureSuccessStatusCode();

        var category = await admin.PostAsJsonAsync("/admin/question-categories", new CreateQuestionCategoryRequest(
            "Own", "Propia", null, null, null, companyId, 1, null, null));
        category.EnsureSuccessStatusCode();
        var categoryId = JsonDocument.Parse(await category.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid();
        (await admin.PostAsJsonAsync("/admin/question-library", new CreateQuestionLibraryItemRequest(
            categoryId, $"Private item {companyId:N}", $"Ítem privado {companyId:N}", "open_ended", companyId,
            null, null, null, null, null, null, null, null, null))).EnsureSuccessStatusCode();

        var logo = new ByteArrayContent(Png);
        logo.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        (await admin.PutAsync($"/admin/companies/{companyId}/logo", logo)).EnsureSuccessStatusCode();

        return (operatorClient, employee);
    }

    [Fact]
    public async Task An_unanswered_company_goes_with_everything_in_it_and_its_audit_trail_stays()
    {
        var (operatorClient, employee) = await FurnishAsync(_companyId);
        var (_, otherPerson) = await _harness.IdentifiedClientAsync(Roles.Employee, _otherCompanyId);
        var auditBefore = await _harness.WithDbAsync(db => db.AuditLogs.CountAsync(a => a.CompanyId == _companyId));
        Assert.True(auditBefore > 0, "the furnishing should have left audit rows under the company");

        var response = await DeleteAsync(operatorClient, _companyId, await NameAsync(_companyId));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await _harness.WithDbAsync(async db =>
        {
            Assert.False(await db.Companies.AnyAsync(c => c.Id == _companyId));
            Assert.False(await db.Users.AnyAsync(u => u.Id == employee));
            Assert.False(await db.Users.AnyAsync(u => u.CompanyId == _companyId));
            Assert.False(await db.Surveys.AnyAsync(s => s.CompanyId == _companyId));
            Assert.False(await db.Departments.AnyAsync(d => d.CompanyId == _companyId));
            Assert.False(await db.CompanyLogos.AnyAsync(l => l.CompanyId == _companyId));

            // Every audit row filed under it is still there, plus the deletion's own.
            Assert.True(await db.AuditLogs.CountAsync(a => a.CompanyId == _companyId) > auditBefore);

            // The other tenant is untouched.
            Assert.True(await db.Companies.AnyAsync(c => c.Id == _otherCompanyId));
            Assert.True(await db.Users.AnyAsync(u => u.Id == otherPerson));
        });
    }

    /// <summary>
    /// Eight tables point at their company with SET NULL, and a null company means GLOBAL. Left to
    /// the cascade, a client's private questionnaire would become every tenant's.
    /// </summary>
    [Fact]
    public async Task A_companys_private_templates_and_questions_are_deleted_never_made_global()
    {
        var (operatorClient, _) = await FurnishAsync(_companyId);

        (await DeleteAsync(operatorClient, _companyId, await NameAsync(_companyId))).EnsureSuccessStatusCode();

        await _harness.WithDbAsync(async db =>
        {
            var marker = _companyId.ToString("N");
            Assert.False(await db.SurveyTemplates.AnyAsync(t => (t.NameEn ?? t.NameEs ?? "").Contains(marker) || (t.NameEs ?? "").Contains(marker)));
            Assert.False(await db.QuestionLibraryItems.AnyAsync(i => i.TextEn.Contains(marker)));
            Assert.False(await db.QuestionCategories.AnyAsync(c => c.CompanyId == null && c.NameEn == "Own" && c.NameEs == "Propia"));
        });
    }

    [Fact]
    public async Task A_company_with_an_answer_is_refused_and_nothing_is_deleted()
    {
        var (operatorClient, employee) = await FurnishAsync(_companyId);
        var surveyId = await _harness.WithDbAsync(db => db.Surveys.Where(s => s.CompanyId == _companyId && s.Status == SurveyStatuses.Active).Select(s => s.Id).FirstAsync());
        await _harness.SeedResponseAsync(surveyId, _companyId, employee);

        var response = await DeleteAsync(operatorClient, _companyId, await NameAsync(_companyId));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("company_has_responses", await response.Content.ReadAsStringAsync());
        Assert.True(await _harness.WithDbAsync(db => db.Users.AnyAsync(u => u.Id == employee)));
    }

    [Fact]
    public async Task A_company_that_holds_a_tims_operator_is_refused()
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        await _harness.ClientAsync(Roles.SuperAdmin, _companyId);

        var response = await DeleteAsync(operatorClient, _companyId, await NameAsync(_companyId));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("company_holds_super_admins", await response.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("otra empresa")]
    public async Task The_name_must_be_typed_exactly(string? typed)
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);

        var response = await DeleteAsync(operatorClient, _companyId, typed);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("company_name_mismatch", await response.Content.ReadAsStringAsync());
        Assert.True(await _harness.WithDbAsync(db => db.Companies.AnyAsync(c => c.Id == _companyId)));
    }

    [Fact]
    public async Task A_company_admin_cannot_delete_even_their_own_company()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        var response = await DeleteAsync(admin, _companyId, await NameAsync(_companyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task The_assessment_says_what_would_go_and_what_refuses_it()
    {
        var (operatorClient, employee) = await FurnishAsync(_companyId);

        using var clean = JsonDocument.Parse(await operatorClient.GetStringAsync($"/admin/companies/{_companyId}/deletion"));
        Assert.True(clean.RootElement.GetProperty("deletable").GetBoolean());
        Assert.Equal(2, clean.RootElement.GetProperty("people").GetInt32());
        Assert.Equal(2, clean.RootElement.GetProperty("surveys").GetInt32());

        var surveyId = await _harness.WithDbAsync(db => db.Surveys.Where(s => s.CompanyId == _companyId && s.Status == SurveyStatuses.Active).Select(s => s.Id).FirstAsync());
        await _harness.SeedResponseAsync(surveyId, _companyId, employee);

        using var answered = JsonDocument.Parse(await operatorClient.GetStringAsync($"/admin/companies/{_companyId}/deletion"));
        Assert.False(answered.RootElement.GetProperty("deletable").GetBoolean());
        Assert.Equal(1, answered.RootElement.GetProperty("responses").GetInt32());
    }
}
