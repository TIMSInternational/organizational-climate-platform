using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateInvitationTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User invitee, Microclimate microclimate)> SeedAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"creator-{Guid.NewGuid():N}@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var invitee = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"invitee-{Guid.NewGuid():N}@acme.test", Name = "Invitee",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.AddRange(creator, invitee);
        await db.SaveChangesAsync();

        var now = DateTimeOffset.UtcNow;
        var microclimate = new Microclimate
        {
            Id = Guid.NewGuid(), TitleEn = "Pulse", CompanyId = company.Id, CreatedBy = creator.Id,
            Scheduling = new MicroclimateScheduling { StartTime = now, EndTime = now.AddMinutes(30) },
            CreatedAt = now, UpdatedAt = now,
        };
        db.Microclimates.Add(microclimate);
        await db.SaveChangesAsync();

        return (company, invitee, microclimate);
    }

    [Fact]
    public async Task Invitation_round_trips_with_metadata_jsonb()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, invitee, microclimate) = await SeedAsync(db);

        var invitation = new MicroclimateInvitation
        {
            Id = Guid.NewGuid(),
            MicroclimateId = microclimate.Id,
            UserId = invitee.Id,
            CompanyId = company.Id,
            Email = invitee.Email,
            InvitationToken = "tok_abc123",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            Metadata = """{"device_type": "mobile"}""",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateInvitations.Add(invitation);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateInvitations.SingleAsync(i => i.Id == invitation.Id);
        Assert.Equal("pending", loaded.Status);
        Assert.Equal(0, loaded.ReminderCount);
        Assert.Contains("mobile", loaded.Metadata);
        Assert.Null(loaded.SentAt);
    }

    [Fact]
    public async Task Invitation_token_is_unique()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, invitee, microclimate) = await SeedAsync(db);

        var first = new MicroclimateInvitation
        {
            Id = Guid.NewGuid(), MicroclimateId = microclimate.Id, UserId = invitee.Id, CompanyId = company.Id,
            Email = invitee.Email, InvitationToken = "duplicate-token", ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateInvitations.Add(first);
        await db.SaveChangesAsync();

        var second = new MicroclimateInvitation
        {
            Id = Guid.NewGuid(), MicroclimateId = microclimate.Id, UserId = invitee.Id, CompanyId = company.Id,
            Email = "other@acme.test", InvitationToken = "duplicate-token", ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateInvitations.Add(second);

        await Assert.ThrowsAnyAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Minimal_row_inserted_via_raw_SQL_still_loads_with_true_intended_defaults()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, invitee, microclimate) = await SeedAsync(db);

        var minimalId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO microclimate_invitations
                 ("Id", microclimate_id, user_id, company_id, email, invitation_token, expires_at, created_at, updated_at)
             VALUES
                 ({minimalId}, {microclimate.Id}, {invitee.Id}, {company.Id}, {invitee.Email},
                  {"minimal-token"}, {now.AddDays(7)}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateInvitations.SingleAsync(i => i.Id == minimalId);
        Assert.Equal("pending", loaded.Status);
        Assert.Equal(0, loaded.ReminderCount);
        Assert.Null(loaded.Metadata);
    }
}
