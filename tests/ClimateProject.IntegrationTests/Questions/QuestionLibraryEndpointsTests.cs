using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Questions;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Questions;

/// <summary>
/// The question library and its category tree (#112).
///
/// What is pinned here that a unit test could not reach: the tenant split really is two separate
/// checks over HTTP (a global row readable by a CompanyAdmin and NOT writable by one), the type
/// vocabulary is the intersection of both wizards rather than everything the platform knows, and
/// the category tree refuses a cycle that no FK could catch.
/// </summary>
[Collection("Postgres")]
public class QuestionLibraryEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _companyDomain = $"qlib-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public QuestionLibraryEndpointsTests(PostgresContainerFixture postgres) => _factory = postgres.App;

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company { Id = Guid.NewGuid(), Name = "Library Co", EmailDomain = _companyDomain, CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<string> SignUpAndGetTokenAsync(HttpClient client, string role, bool companyLess = false)
    {
        var email = $"{Guid.NewGuid():N}@{_companyDomain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Test User", email, "a-good-password"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = role;
            // A super_admin carries no tenant (#191), which is exactly the caller that may write global rows.
            user.CompanyId = companyLess ? null : _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "a-good-password"));
        return (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
    }

    private async Task<HttpClient> ClientForAsync(string role, bool companyLess = false)
    {
        var client = _factory.CreateClient();
        var token = await SignUpAndGetTokenAsync(client, role, companyLess);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static CreateQuestionCategoryRequest Category(Guid? companyId, string name = "Engagement")
        => new(name, $"{name} (es)", null, null, null, companyId, 0, null, null);

    private static CreateQuestionLibraryItemRequest Item(Guid categoryId, Guid? companyId, string type = "likert")
        => new(categoryId, "How supported do you feel?", "¿Qué tan apoyado te sientes?", type, companyId,
            1, 5, null, null, null, null, "engagement", ["culture"], null);

    [Fact]
    public async Task A_company_admin_can_create_a_category_and_an_item_in_their_own_company()
    {
        var client = await ClientForAsync(Roles.CompanyAdmin);

        var categoryResponse = await client.PostAsJsonAsync("/admin/question-categories", Category(_companyId));
        Assert.Equal(HttpStatusCode.OK, categoryResponse.StatusCode);
        var category = (await categoryResponse.Content.ReadFromJsonAsync<QuestionCategoryListItem>())!;

        var itemResponse = await client.PostAsJsonAsync("/admin/question-library", Item(category.Id, _companyId));
        Assert.Equal(HttpStatusCode.OK, itemResponse.StatusCode);
        var item = (await itemResponse.Content.ReadFromJsonAsync<QuestionLibraryItemDetail>())!;

        Assert.Equal("both", item.Language);
        Assert.Equal(["culture"], item.Tags);
        Assert.Equal(1, item.Version);
    }

    /// <summary>
    /// The tenant split, and the whole reason read and write are separate checks: a global row is
    /// visible to every tenant, so letting one tenant write it would be a cross-tenant write.
    /// </summary>
    [Fact]
    public async Task A_company_admin_may_read_a_global_category_but_not_create_one()
    {
        var superAdmin = await ClientForAsync(Roles.SuperAdmin, companyLess: true);
        var created = await superAdmin.PostAsJsonAsync("/admin/question-categories", Category(null, "Global"));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);

        var companyAdmin = await ClientForAsync(Roles.CompanyAdmin);

        var list = await companyAdmin.GetFromJsonAsync<QuestionCategoryListResponse>("/admin/question-categories");
        Assert.Contains(list!.Categories, c => c.CompanyId is null && c.NameEn == "Global");

        var attempt = await companyAdmin.PostAsJsonAsync("/admin/question-categories", Category(null, "Sneaky"));
        Assert.Equal(HttpStatusCode.Forbidden, attempt.StatusCode);
    }

    [Fact]
    public async Task A_company_admin_cannot_edit_a_global_item_every_tenant_can_see()
    {
        var superAdmin = await ClientForAsync(Roles.SuperAdmin, companyLess: true);
        var category = (await (await superAdmin.PostAsJsonAsync("/admin/question-categories", Category(null, "Shared")))
            .Content.ReadFromJsonAsync<QuestionCategoryListItem>())!;
        var item = (await (await superAdmin.PostAsJsonAsync("/admin/question-library", Item(category.Id, null)))
            .Content.ReadFromJsonAsync<QuestionLibraryItemDetail>())!;

        var companyAdmin = await ClientForAsync(Roles.CompanyAdmin);

        // Readable...
        var read = await companyAdmin.GetAsync($"/admin/question-library/{item.Id}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);

        // ...but not writable.
        var write = await companyAdmin.PutAsJsonAsync($"/admin/question-library/{item.Id}",
            new UpdateQuestionLibraryItemRequest(category.Id, "Rewritten", "Reescrito", null, null, null, null, null, null, null, null, null, null));
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
    }

    /// <summary>
    /// `ranking` is in <c>ForSurvey</c> and not in <c>ForMicroclimate</c>. Accepting it here would
    /// let an author create an item that is uninstantiable into one of the two wizards the picker
    /// serves — a failure discovered at pick time instead of create time.
    /// </summary>
    [Fact]
    public async Task A_type_only_one_wizard_accepts_is_refused_at_authoring_time()
    {
        var client = await ClientForAsync(Roles.CompanyAdmin);
        var category = (await (await client.PostAsJsonAsync("/admin/question-categories", Category(_companyId)))
            .Content.ReadFromJsonAsync<QuestionCategoryListItem>())!;

        var response = await client.PostAsJsonAsync("/admin/question-library", Item(category.Id, _companyId, "ranking"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain("ranking", QuestionRepositoryTypes.Supported);
    }

    /// <summary>
    /// Each edge is individually valid, so no foreign key can catch this — the rows survive and
    /// nothing can reach them, which is why the walk to the root exists.
    /// </summary>
    [Fact]
    public async Task Reparenting_a_category_under_its_own_descendant_is_refused_as_a_cycle()
    {
        var client = await ClientForAsync(Roles.CompanyAdmin);
        var root = (await (await client.PostAsJsonAsync("/admin/question-categories", Category(_companyId, "Root")))
            .Content.ReadFromJsonAsync<QuestionCategoryListItem>())!;
        var child = (await (await client.PostAsJsonAsync("/admin/question-categories",
                new CreateQuestionCategoryRequest("Child", "Hijo", null, null, root.Id, _companyId, 0, null, null)))
            .Content.ReadFromJsonAsync<QuestionCategoryListItem>())!;

        var response = await client.PutAsJsonAsync($"/admin/question-categories/{root.Id}",
            new UpdateQuestionCategoryRequest("Root", "Raíz", null, null, child.Id, null, null, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_category_cannot_be_its_own_parent()
    {
        var client = await ClientForAsync(Roles.CompanyAdmin);
        var category = (await (await client.PostAsJsonAsync("/admin/question-categories", Category(_companyId)))
            .Content.ReadFromJsonAsync<QuestionCategoryListItem>())!;

        var response = await client.PutAsJsonAsync($"/admin/question-categories/{category.Id}",
            new UpdateQuestionCategoryRequest("Self", "Sí", null, null, category.Id, null, null, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>Duplicate values make an answer ambiguous, which is what the stable value exists to prevent.</summary>
    [Fact]
    public async Task Two_options_may_not_share_a_stable_value()
    {
        var client = await ClientForAsync(Roles.CompanyAdmin);
        var category = (await (await client.PostAsJsonAsync("/admin/question-categories", Category(_companyId)))
            .Content.ReadFromJsonAsync<QuestionCategoryListItem>())!;

        var response = await client.PostAsJsonAsync("/admin/question-library",
            new CreateQuestionLibraryItemRequest(category.Id, "Pick one", "Elige uno", "multiple_choice", _companyId,
                null, null, null, null, null, null, null, null,
                [new RepositoryOptionInput("same", "A", "A"), new RepositoryOptionInput("same", "B", "B")]));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_multiple_choice_item_with_no_options_is_refused()
    {
        var client = await ClientForAsync(Roles.CompanyAdmin);
        var category = (await (await client.PostAsJsonAsync("/admin/question-categories", Category(_companyId)))
            .Content.ReadFromJsonAsync<QuestionCategoryListItem>())!;

        var response = await client.PostAsJsonAsync("/admin/question-library",
            new CreateQuestionLibraryItemRequest(category.Id, "Pick one", "Elige uno", "multiple_choice", _companyId,
                null, null, null, null, null, null, null, null, null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_employee_is_refused_the_library_entirely()
    {
        var client = await ClientForAsync(Roles.Employee);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/admin/question-library")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/admin/question-categories")).StatusCode);
    }

    /// <summary>Counted, never stored — the legacy model kept a denormalised counter that could go stale.</summary>
    [Fact]
    public async Task A_categorys_item_count_reflects_what_is_actually_filed_under_it()
    {
        var client = await ClientForAsync(Roles.CompanyAdmin);
        var category = (await (await client.PostAsJsonAsync("/admin/question-categories", Category(_companyId, "Counted")))
            .Content.ReadFromJsonAsync<QuestionCategoryListItem>())!;
        Assert.Equal(0, category.ItemCount);

        await client.PostAsJsonAsync("/admin/question-library", Item(category.Id, _companyId));

        var list = await client.GetFromJsonAsync<QuestionCategoryListResponse>("/admin/question-categories");
        Assert.Equal(1, list!.Categories.Single(c => c.Id == category.Id).ItemCount);
    }
}
