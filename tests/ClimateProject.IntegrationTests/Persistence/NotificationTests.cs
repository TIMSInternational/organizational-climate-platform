using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class NotificationTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db, string emailSuffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"person-{emailSuffix}@acme.test", Name = "Person",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    [Fact]
    public async Task Notification_round_trips_with_owned_metadata_and_jsonb_data()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db, "1");

        var notification = new Notification
        {
            Id = Guid.NewGuid(),
            UserId = user.Id,
            CompanyId = company.Id,
            Type = "survey_invitation",
            Channel = "email",
            Priority = "high",
            Status = "sent",
            Title = "New survey available",
            Message = "Please complete the Q3 climate survey.",
            Data = """{"survey_id": "abc123"}""",
            ScheduledFor = DateTimeOffset.UtcNow,
            SentAt = DateTimeOffset.UtcNow,
            RetryCount = 1,
            MaxRetries = 5,
            Metadata = new NotificationMetadata { UserAgent = "Mozilla/5.0", DeviceType = "desktop" },
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Notifications.SingleAsync(n => n.Id == notification.Id);
        Assert.Equal("survey_invitation", loaded.Type);
        Assert.Equal("high", loaded.Priority);
        Assert.Equal("sent", loaded.Status);
        Assert.Contains("abc123", loaded.Data);
        Assert.Equal(1, loaded.RetryCount);
        Assert.Equal(5, loaded.MaxRetries);
        Assert.Equal("Mozilla/5.0", loaded.Metadata.UserAgent);
        Assert.Equal("desktop", loaded.Metadata.DeviceType);
        Assert.Null(loaded.Metadata.IpAddress);
    }

    [Fact]
    public async Task Minimal_notification_inserted_via_raw_SQL_still_loads_with_DB_level_defaults()
    {
        // Proves the DB-level column defaults (declared via .HasDefaultValue(...) in the Fluent
        // config, baked into the migration's CreateTable column definitions) are what a row gets
        // when only the truly-required columns are set — not merely the C# object-initializer
        // defaults that a raw-SQL insert (or any non-EF writer) would never pick up.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db, "2");

        var minimalId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO notifications ("Id", user_id, company_id, type, channel, title, message, scheduled_for, created_at, updated_at)
             VALUES ({minimalId}, {user.Id}, {company.Id}, {"system_notification"}, {"in_app"}, {"System notice"}, {"Something happened."}, {now}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Notifications.SingleAsync(n => n.Id == minimalId);
        Assert.Equal("medium", loaded.Priority);
        Assert.Equal("pending", loaded.Status);
        Assert.Equal(0, loaded.RetryCount);
        Assert.Equal(3, loaded.MaxRetries);
        Assert.Null(loaded.Data);
        Assert.Null(loaded.TemplateId);
        Assert.Null(loaded.SentAt);
        Assert.Null(loaded.Metadata.UserAgent);
        Assert.Null(loaded.Metadata.IpAddress);
        Assert.Null(loaded.Metadata.EmailClient);
        Assert.Null(loaded.Metadata.DeviceType);
    }
}
