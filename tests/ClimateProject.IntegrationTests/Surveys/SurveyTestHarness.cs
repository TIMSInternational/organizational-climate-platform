using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Signup/role/company boilerplate shared by the three survey test classes.
///
/// Extracted rather than copy-pasted three times: each class needs two tenants, several
/// roles and a department, and three divergent copies of that setup is how a
/// cross-tenant test comes to pass for the wrong reason.
/// </summary>
internal sealed class SurveyTestHarness(AuthWebApplicationFactory factory, string emailDomain)
{
    public AuthWebApplicationFactory Factory { get; } = factory;

    public string EmailDomain { get; } = emailDomain;

    public async Task<string> TokenAsync(string role, Guid? companyId, Guid? departmentId = null)
    {
        var client = Factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{EmailDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        signup.EnsureSuccessStatusCode();

        using (var scope = Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            user.CompanyId = companyId;
            user.DepartmentId = departmentId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    public async Task<HttpClient> ClientAsync(string role, Guid? companyId, Guid? departmentId = null)
    {
        var token = await TokenAsync(role, companyId, departmentId);
        var client = Factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    public async Task<T> WithDbAsync<T>(Func<ClimateProjectDbContext, Task<T>> action)
    {
        using var scope = Factory.Services.CreateScope();
        return await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    public async Task WithDbAsync(Func<ClimateProjectDbContext, Task> action)
    {
        using var scope = Factory.Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>());
    }

    /// <summary>
    /// Each seeded company gets its OWN email domain. <c>companies.email_domain</c> carries
    /// a filtered unique index, so reusing the harness's signup domain across two tenants
    /// would fail the insert -- and every test in this class needs two tenants to prove a
    /// cross-tenant denial. Users are signed up under <see cref="EmailDomain"/> and then
    /// re-homed by <see cref="TokenAsync"/>, so the two never have to match.
    /// </summary>
    public Task<Guid> SeedCompanyAsync(string name, string language = "en")
        => WithDbAsync(async db =>
        {
            var company = new Company
            {
                Id = Guid.NewGuid(),
                Name = name,
                EmailDomain = $"{Guid.NewGuid():N}.tenant.test",
                CreatedAt = DateTimeOffset.UtcNow,
            };
            company.Settings.Language = language;
            db.Companies.Add(company);
            await db.SaveChangesAsync();
            return company.Id;
        });

    public Task<Guid> SeedDepartmentAsync(Guid companyId, string name)
        => WithDbAsync(async db =>
        {
            var department = new Department
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Name = name,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.Departments.Add(department);
            await db.SaveChangesAsync();
            return department.Id;
        });

    /// <summary>
    /// Inserts a completed response directly. There is no respond endpoint yet (#106), and
    /// the immutability rules have to be provable before one exists -- a rule that only
    /// becomes testable once the thing it protects against is buildable is a rule that
    /// ships untested.
    /// </summary>
    public Task SeedResponseAsync(Guid surveyId, Guid companyId, Guid? userId, bool isComplete = true, string language = "en")
        => WithDbAsync(async db =>
        {
            db.Responses.Add(new Response
            {
                Id = Guid.NewGuid(),
                SurveyId = surveyId,
                CompanyId = companyId,
                UserId = userId,
                SessionId = Guid.NewGuid().ToString("N"),
                Language = language,
                IsComplete = isComplete,
                StartTime = DateTimeOffset.UtcNow,
                CompletionTime = isComplete ? DateTimeOffset.UtcNow : null,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });

            var survey = await db.Surveys.FirstAsync(s => s.Id == surveyId);
            survey.ResponseCount += 1;
            await db.SaveChangesAsync();
        });

    /// <summary>Forces a status the lifecycle would not permit, so a guard can be tested in isolation.</summary>
    public Task ForceStatusAsync(Guid surveyId, string status)
        => WithDbAsync(async db =>
        {
            var survey = await db.Surveys.FirstAsync(s => s.Id == surveyId);
            survey.Status = status;
            await db.SaveChangesAsync();
        });

    public static LocalizedInput Both(string en, string es)
        => LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = en, ["es"] = es });

    public static CreateSurveyRequest MinimalRequest(
        Guid companyId,
        LocalizedInput? title = null,
        List<CreateSurveyQuestionInput>? questions = null,
        string? language = null,
        List<Guid>? departmentIds = null)
        => new(
            Title: title ?? LocalizedInput.FromBare("Q3 Climate Survey"),
            CompanyId: companyId,
            Type: "general_climate",
            StartDate: DateTimeOffset.UtcNow.AddDays(-1),
            EndDate: DateTimeOffset.UtcNow.AddDays(14),
            DepartmentIds: departmentIds,
            Questions: questions ?? [new CreateSurveyQuestionInput(LocalizedInput.FromBare("How are you feeling?"), "open_ended", Order: 0)],
            Language: language);

    public static async Task<SurveyDetail> CreateSurveyAsync(HttpClient client, CreateSurveyRequest request)
    {
        var response = await client.PostAsJsonAsync("/surveys", request);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SurveyDetail>())!;
    }

    public static Task<HttpResponseMessage> SetStatusAsync(HttpClient client, Guid surveyId, string status)
        => client.PutAsJsonAsync($"/surveys/{surveyId}/status", new UpdateSurveyStatusRequest(status));
}
