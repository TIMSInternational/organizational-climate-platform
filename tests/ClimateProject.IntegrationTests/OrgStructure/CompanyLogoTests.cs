using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.IntegrationTests.Surveys;
using ClimateProject.IntegrationTests.Support;

namespace ClimateProject.IntegrationTests.OrgStructure;

/// <summary>
/// An uploaded logo (docs/audits/2026-11-08-operator-ui-walkthrough.md, B4): until this, every new
/// client's logo was a file a developer committed under web/public/brand/ and deployed.
/// </summary>
[Collection("Postgres")]
public class CompanyLogoTests : IAsyncLifetime
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8];

    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;
    private Guid _otherCompanyId;

    public CompanyLogoTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"logos-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyId = await _harness.SeedCompanyAsync("Logo Co");
        _otherCompanyId = await _harness.SeedCompanyAsync("Other Co");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpResponseMessage> UploadAsync(HttpClient client, Guid companyId, byte[] bytes, string declaredType = "image/png")
    {
        var body = new ByteArrayContent(bytes);
        body.Headers.ContentType = new MediaTypeHeaderValue(declaredType);
        return client.PutAsync($"/admin/companies/{companyId}/logo", body);
    }

    [Fact]
    public async Task A_super_admin_uploads_a_logo_that_anyone_can_then_load_from_the_versioned_path()
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);

        var response = await UploadAsync(operatorClient, _companyId, Png);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var logoUrl = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("logoUrl").GetString()!;
        Assert.StartsWith($"/logos/{_companyId}?v=", logoUrl);

        // The branding now points at it -- the path every screen and email resolves.
        var settings = await operatorClient.GetStringAsync($"/admin/companies/{_companyId}/settings");
        Assert.Contains(logoUrl, settings);

        // Respondents and mail clients load it with no credentials at all.
        var served = await _factory.CreateClient().GetAsync($"/public/company-logos/{_companyId}");
        Assert.Equal(HttpStatusCode.OK, served.StatusCode);
        Assert.Equal("image/png", served.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await served.Content.ReadAsByteArrayAsync());
        Assert.Equal("nosniff", served.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task The_type_is_read_off_the_bytes_so_a_text_file_labelled_png_is_refused()
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);

        var response = await UploadAsync(operatorClient, _companyId, "<svg onload=alert(1)>"u8.ToArray());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("logo_not_an_image", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_logo_over_512_KB_is_refused()
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var big = new byte[(512 * 1024) + 1];
        Png.CopyTo(big, 0);

        var response = await UploadAsync(operatorClient, _companyId, big);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("logo_too_large", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_company_admin_uploads_their_own_logo_but_never_another_companys()
    {
        var admin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyId);

        Assert.Equal(HttpStatusCode.OK, (await UploadAsync(admin, _companyId, Png)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await UploadAsync(admin, _otherCompanyId, Png)).StatusCode);
    }

    [Fact]
    public async Task A_company_with_no_uploaded_logo_serves_nothing()
    {
        var served = await _factory.CreateClient().GetAsync($"/public/company-logos/{_otherCompanyId}");

        Assert.Equal(HttpStatusCode.NotFound, served.StatusCode);
    }
}
