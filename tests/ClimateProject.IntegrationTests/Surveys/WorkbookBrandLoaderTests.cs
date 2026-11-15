using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Exports;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Surveys;

/// <summary>
/// Where a workbook's logo comes from: an uploaded logo from the database, a path from the web
/// origin and nowhere else, and never a reason for the download to fail.
/// </summary>
[Collection("Postgres")]
public class WorkbookBrandLoaderTests : IAsyncLifetime
{
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=");

    private static readonly IConfiguration Web = new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["Email:AppBaseUrl"] = "https://climate.example" })
        .Build();

    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private Guid _companyId;

    public WorkbookBrandLoaderTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"brand-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync() => _companyId = await _harness.SeedCompanyAsync("Marca Co");

    public Task DisposeAsync() => Task.CompletedTask;

    private static Task<byte[]?> NoFetch(Uri address, CancellationToken cancellationToken)
        => throw new Xunit.Sdk.XunitException($"No fetch was expected, but {address} was asked for.");

    private async Task<WorkbookBrand> LoadAsync(Func<Uri, CancellationToken, Task<byte[]?>> fetch)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        return await WorkbookBrandLoader.LoadAsync(db, _companyId, Web, CancellationToken.None, fetch: fetch);
    }

    private async Task SetBrandingAsync(string? logoUrl = null, string? primaryColor = null)
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var response = await operatorClient.PutAsJsonAsync($"/admin/companies/{_companyId}/settings", new UpdateCompanySettingsRequest(
            null, null, null, null, null, null, null, logoUrl, primaryColor, null, null, null));
        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task An_uploaded_logo_is_read_from_the_database_and_nothing_is_fetched()
    {
        var operatorClient = await _harness.ClientAsync(Roles.SuperAdmin, companyId: null);
        var body = new ByteArrayContent(Png);
        body.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        (await operatorClient.PutAsync($"/admin/companies/{_companyId}/logo", body)).EnsureSuccessStatusCode();

        var brand = await LoadAsync(NoFetch);

        Assert.Equal(Png, brand.Logo);
        Assert.Equal("Marca Co", brand.CompanyName);
    }

    [Fact]
    public async Task A_logo_set_as_a_path_is_fetched_from_the_web_origin()
    {
        await SetBrandingAsync(logoUrl: "/brand/esph-logo.png");
        Uri? asked = null;

        var brand = await LoadAsync((address, _) =>
        {
            asked = address;
            return Task.FromResult<byte[]?>(Png);
        });

        Assert.Equal(new Uri("https://climate.example/brand/esph-logo.png"), asked);
        Assert.Equal(Png, brand.Logo);
    }

    [Fact]
    public async Task An_unreachable_logo_leaves_the_brand_without_one_and_does_not_throw()
    {
        await SetBrandingAsync(logoUrl: "/brand/esph-logo.png", primaryColor: "#0B6E4F");

        var brand = await LoadAsync((_, _) => throw new HttpRequestException("connection refused"));

        Assert.Null(brand.Logo);
        Assert.Equal("#0B6E4F", brand.Accent);
        Assert.Equal("Marca Co", brand.CompanyName);
    }

    [Fact]
    public async Task No_logo_means_no_fetch_and_the_companys_colour()
    {
        await SetBrandingAsync(primaryColor: "#0B6E4F");

        var brand = await LoadAsync(NoFetch);

        Assert.Null(brand.Logo);
        Assert.Equal("#0B6E4F", brand.Accent);
    }
}
