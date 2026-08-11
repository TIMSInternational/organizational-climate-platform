using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Auth;

/// <summary>
/// <c>ActingUserResolver.ResolveSecurityStampAsync</c> answers for the same row
/// <c>ActingUserResolver.ResolveAsync</c> does — for every shape of <c>sub</c>, including a
/// colliding one.
/// </summary>
/// <remarks>
/// #285 established that the <c>sub</c> claim is minted as <c>PersonaExternalId ?? Id</c> and
/// that a resolver must therefore try <c>PersonaExternalId</c> FIRST: the column is a
/// free-form legacy string, so one user's <c>PersonaExternalId</c> can equal another user's
/// <c>Id</c>, and an <c>Id</c>-first resolver hands the first user's token the second user's
/// row. #284 added a second resolver on the same claim — one that runs on every authenticated
/// request, and so fetches both candidates in a single statement instead of two sequential
/// ones — and a second implementation of an ordering is exactly how the ordering stops being
/// one ordering.
///
/// Getting it wrong here is not merely a wrong answer: under a collision, a stamp resolver
/// that picked the <c>Id</c> row would compare the presented token against the WRONG user's
/// stamp. The likely outcome is a mismatch and a permanent 401 for a legitimate caller; the
/// unlikely-but-worse one is that rotating user B's stamp does nothing to user A's tokens.
///
/// So this compares the two resolvers against a seeded collision rather than trusting the
/// remark on the method that says they agree.
/// </remarks>
[Collection("Postgres")]
public class SecurityStampMatchesActingUserResolverTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly Company _company = new()
    {
        Id = Guid.NewGuid(),
        Name = "Acme",
        EmailDomain = $"acme-{Guid.NewGuid():N}.test",
        CreatedAt = DateTimeOffset.UtcNow,
    };

    /// <summary>The row whose <c>PersonaExternalId</c> spells <see cref="_victim"/>'s id.</summary>
    private User _collider = null!;

    private User _victim = null!;
    private User _plain = null!;

    public SecurityStampMatchesActingUserResolverTests(PostgresContainerFixture postgres)
    {
        _factory = new AuthWebApplicationFactory(postgres.ConnectionString);
    }

    public async Task InitializeAsync()
    {
        await _factory.ApplyMigrationsAsync();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.Companies.Add(_company);

        _victim = NewUser("victim");
        _collider = NewUser("collider");
        _collider.PersonaExternalId = _victim.Id.ToString();
        _plain = NewUser("plain");

        db.Users.AddRange(_victim, _collider, _plain);
        await db.SaveChangesAsync();

        // The seeding is the whole premise, so it is asserted rather than assumed.
        Assert.NotEqual(_victim.SecurityStamp, _collider.SecurityStamp);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task A_colliding_sub_resolves_to_the_PersonaExternalId_row_in_both_resolvers()
        => await AssertBothResolversAgreeAsync(_collider.PersonaExternalId!, _collider);

    [Fact]
    public async Task A_plain_id_sub_resolves_to_that_row_in_both_resolvers()
        => await AssertBothResolversAgreeAsync(_plain.Id.ToString(), _plain);

    [Fact]
    public async Task A_sub_that_matches_nothing_resolves_to_no_stamp()
        => await AssertBothResolversAgreeAsync(Guid.NewGuid().ToString(), expected: null);

    /// <summary>
    /// A <c>sub</c> that is not a Guid at all. The single-statement query has to keep the
    /// <c>Id</c> half of its <c>WHERE</c> from matching anything in that case rather than
    /// throwing — the reason the two-step resolver guards with <c>Guid.TryParse</c>.
    /// </summary>
    [Fact]
    public async Task A_non_guid_sub_resolves_to_no_stamp()
        => await AssertBothResolversAgreeAsync("not-a-guid-at-all", expected: null);

    private async Task AssertBothResolversAgreeAsync(string sub, User? expected)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();

        var viaStampResolver = await ActingUserResolver.ResolveSecurityStampAsync(
            sub, db, CancellationToken.None);

        var viaRowResolver = await ActingUserResolver.ResolveAsync(
            CurrentUserWith(sub), db, CancellationToken.None);

        Assert.Equal(expected?.Id, viaRowResolver?.Id);
        Assert.Equal(viaRowResolver?.SecurityStamp, viaStampResolver);
    }

    private static CurrentUser CurrentUserWith(string sub) => new(
        Sub: sub,
        Role: Roles.Employee,
        NodoId: null,
        Email: "unused@example.test",
        Name: "Unused",
        CompanyId: string.Empty,
        IsActive: true);

    private User NewUser(string label) => new()
    {
        Id = Guid.NewGuid(),
        CompanyId = _company.Id,
        Email = $"{label}-{Guid.NewGuid():N}@{_company.EmailDomain}",
        Name = label,
        Role = Roles.Employee,
        IsActive = true,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };
}
