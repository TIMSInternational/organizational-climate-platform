using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class UserInvitationTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    [Fact]
    public async Task UserInvitation_round_trips_with_jsonb_fields()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var inviter = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(inviter);
        await db.SaveChangesAsync();

        var invitation = new UserInvitation
        {
            Id = Guid.NewGuid(),
            Email = "invitee@acme.test",
            CompanyId = company.Id,
            InvitedBy = inviter.Id,
            InvitationToken = Guid.NewGuid().ToString("N"),
            InvitationType = "direct_invitation",
            Role = "employee",
            Status = "sent",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
            SentAt = DateTimeOffset.UtcNow,
            InvitationData = """{"company_name": "Acme", "inviter_name": "Admin"}""",
        };
        db.UserInvitations.Add(invitation);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.UserInvitations.SingleAsync(i => i.Id == invitation.Id);
        Assert.Equal("sent", loaded.Status);
        Assert.Equal("direct_invitation", loaded.InvitationType);
        Assert.Contains("Acme", loaded.InvitationData);
    }

    [Fact]
    public async Task UserInvitation_token_is_unique()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Acme2", CreatedAt = DateTimeOffset.UtcNow };
        var inviter = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "admin2@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(inviter);
        await db.SaveChangesAsync();

        var token = "duplicate-token";
        db.UserInvitations.Add(new UserInvitation
        {
            Id = Guid.NewGuid(), Email = "a@acme.test", CompanyId = company.Id, InvitedBy = inviter.Id,
            InvitationToken = token, InvitationType = "direct_invitation", Role = "employee", Status = "sent",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
        });
        await db.SaveChangesAsync();

        db.UserInvitations.Add(new UserInvitation
        {
            Id = Guid.NewGuid(), Email = "b@acme.test", CompanyId = company.Id, InvitedBy = inviter.Id,
            InvitationToken = token, InvitationType = "direct_invitation", Role = "employee", Status = "sent",
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
