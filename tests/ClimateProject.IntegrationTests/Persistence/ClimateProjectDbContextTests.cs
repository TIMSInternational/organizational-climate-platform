using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class ClimateProjectDbContextTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    [Fact]
    public async Task Migrations_create_companies_and_users_tables_and_round_trip_data()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Acme Corp",
            EmailDomain = "acme.test",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);

        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = "person@acme.test",
            Name = "Person One",
            PasswordHash = "hash",
            Role = "employee",
            IsActive = true,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);

        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedUser = await readDb.Users.SingleAsync(u => u.Id == user.Id);
        Assert.Equal("person@acme.test", loadedUser.Email);
        Assert.Equal(company.Id, loadedUser.CompanyId);

        var loadedCompany = await readDb.Companies.SingleAsync(c => c.Id == company.Id);
        Assert.Equal("acme.test", loadedCompany.EmailDomain);
    }

    [Fact]
    public async Task Users_email_is_unique()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = "dupe@acme.test",
            Name = "First",
            Role = "employee",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = "dupe@acme.test",
            Name = "Second",
            Role = "employee",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
