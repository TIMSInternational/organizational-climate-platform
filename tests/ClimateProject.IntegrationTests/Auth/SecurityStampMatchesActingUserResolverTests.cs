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
/// ## Why a second resolver needed pinning at all
///
/// #285 established that the <c>sub</c> claim is minted as <c>PersonaExternalId ?? Id</c> and
/// that a resolver must therefore try <c>PersonaExternalId</c> FIRST: the column is a
/// free-form legacy string, so one user's <c>PersonaExternalId</c> can equal another user's
/// <c>Id</c>, and an <c>Id</c>-first resolver hands the first user's token the second user's
/// row. #284 added a second resolver on the same claim — one that runs on every authenticated
/// request, and so fetches both candidates in a single statement instead of two sequential
/// ones — and a second implementation of an ordering is how an ordering stops being one
/// ordering.
///
/// Under a collision, a stamp resolver that picked the <c>Id</c> row would compare the
/// presented token against the WRONG user's stamp. The likely outcome is a permanent 401 for
/// a legitimate caller; the worse one is that rotating user B's stamp does nothing to user
/// A's tokens.
///
/// ## Two collisions, seeded in opposite physical order, and that is the point
///
/// The single-statement query is an unordered <c>WHERE ... OR ...</c>, so which of the two
/// candidate rows arrives first is Postgres's business — in practice the heap order, i.e. the
/// order they were inserted. A single collision therefore cannot prove the ordering is
/// applied: with the in-memory <c>PersonaExternalId</c>-first step deleted entirely, a
/// one-pair version of this class still passed, because the row it wanted happened to be the
/// one that came back first. That is a test that cannot fail, and it was measured here rather
/// than reasoned about.
///
/// So there are two pairs, inserted with separate saves so their heap order is known and
/// opposite: in pair A the <c>Id</c> row is written first, in pair B the
/// <c>PersonaExternalId</c> row is. Whichever end of the returned list a position-based pick
/// takes, one of the two facts below fails.
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

    // Pair A: the row whose Id the sub spells is inserted BEFORE the row whose
    // PersonaExternalId it spells.
    private User _victimA = null!;
    private User _colliderA = null!;

    // Pair B: the same collision, inserted the other way round.
    private User _colliderB = null!;
    private User _victimB = null!;

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
        await db.SaveChangesAsync();

        _victimA = NewUser("victim-a");
        _colliderA = NewUser("collider-a");
        _colliderA.PersonaExternalId = _victimA.Id.ToString();

        _colliderB = NewUser("collider-b");
        _victimB = NewUser("victim-b");
        _colliderB.PersonaExternalId = _victimB.Id.ToString();

        _plain = NewUser("plain");

        // One save each, in this order, so the two pairs occupy the heap in opposite order.
        foreach (var user in new[] { _victimA, _colliderA, _colliderB, _victimB, _plain })
        {
            db.Users.Add(user);
            await db.SaveChangesAsync();
        }

        // The seeding is the whole premise, so it is asserted rather than assumed.
        Assert.NotEqual(_victimA.SecurityStamp, _colliderA.SecurityStamp);
        Assert.NotEqual(_victimB.SecurityStamp, _colliderB.SecurityStamp);
    }

    public Task DisposeAsync() => Task.CompletedTask;

    /// <summary>Collision where the <c>Id</c> row was written first.</summary>
    [Fact]
    public async Task A_colliding_sub_resolves_to_the_PersonaExternalId_row_when_the_id_row_is_older()
        => await AssertBothResolversAgreeAsync(_colliderA.PersonaExternalId!, _colliderA);

    /// <summary>The same collision with the two rows written the other way round.</summary>
    [Fact]
    public async Task A_colliding_sub_resolves_to_the_PersonaExternalId_row_when_the_id_row_is_newer()
        => await AssertBothResolversAgreeAsync(_colliderB.PersonaExternalId!, _colliderB);

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
        Assert.Equal(expected?.SecurityStamp, viaStampResolver);
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
