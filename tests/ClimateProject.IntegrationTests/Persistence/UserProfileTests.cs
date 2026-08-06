using ClimateProject.Application.OrgStructure;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class UserProfileTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    [Fact]
    public async Task User_profile_fields_department_link_and_normalised_demographics_round_trip()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var department = new Department { Id = Guid.NewGuid(), CompanyId = company.Id, Name = "Eng", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        db.Departments.Add(department);
        await db.SaveChangesAsync();

        var manager = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "manager@acme.test", Name = "Manager",
            Role = "leader", DepartmentId = department.Id,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(manager);
        await db.SaveChangesAsync();

        var employee = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "employee@acme.test", Name = "Employee",
            Role = "employee", DepartmentId = department.Id, ManagerId = manager.Id,
            ConsentUpdatedAt = DateTimeOffset.UtcNow,
            Preferences = new UserPreferences { Theme = "dark" },
            Notifications = new NotificationPreferences
            {
                EmailReminders = false,
                PushNotifications = true,
                DigestFrequency = NotificationPreferenceValidation.DigestNever,
            },
            Consent = new UserConsent { Analytics = true },
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(employee);
        await db.SaveChangesAsync();

        // Demographics are no longer a jsonb blob on users: each answer is a row in
        // user_demographics keyed by the company's demographic_fields definition.
        var siteLocation = new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Field = "site_location", Label = "Site location",
            Type = "select", Options = ["Remote", "Onsite"], Required = false, Order = 0,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DemographicFields.Add(siteLocation);
        db.UserDemographics.Add(new UserDemographic
        {
            UserId = employee.Id, DemographicFieldId = siteLocation.Id, Value = "Remote",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Users.SingleAsync(u => u.Id == employee.Id);
        Assert.Equal(department.Id, loaded.DepartmentId);
        Assert.Equal(manager.Id, loaded.ManagerId);
        Assert.Equal("dark", loaded.Preferences.Theme);
        Assert.True(loaded.Consent.Analytics);
        Assert.True(loaded.Consent.Essential);

        // A user who has changed some notification preferences keeps exactly those changes
        // and keeps the legacy defaults for the rest -- an edit must not reset its neighbours.
        Assert.False(loaded.Notifications.EmailReminders);
        Assert.True(loaded.Notifications.PushNotifications);
        Assert.Equal("never", loaded.Notifications.DigestFrequency);
        Assert.True(loaded.Notifications.EmailSurveys);
        Assert.True(loaded.Notifications.EmailMicroclimates);
        Assert.True(loaded.Notifications.EmailActionPlans);

        var demographics = await readDb.UserDemographics.Where(d => d.UserId == employee.Id).ToListAsync();
        var single = Assert.Single(demographics);
        Assert.Equal(siteLocation.Id, single.DemographicFieldId);
        Assert.Equal("Remote", single.Value);
    }

    [Fact]
    public async Task A_user_can_hold_only_one_answer_per_demographic_field()
    {
        // The composite primary key is what replaces the jsonb object's implicit
        // "one value per key" guarantee. Without it, normalising would be a
        // regression: two rows for the same field would make every dashboard
        // filter and export double-count that user.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Dup Co", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "dup@dup.test", Name = "Dup",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        var field = new DemographicField
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Field = "tenure", Label = "Tenure",
            Type = "text", Required = false, Order = 0,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        db.DemographicFields.Add(field);
        db.UserDemographics.Add(new UserDemographic
        {
            UserId = user.Id, DemographicFieldId = field.Id, Value = "2 years",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        // A second context so the duplicate reaches Postgres rather than being caught
        // by the first context's change tracker.
        await using var secondDb = CreateContext();
        secondDb.UserDemographics.Add(new UserDemographic
        {
            UserId = user.Id, DemographicFieldId = field.Id, Value = "3 years",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => secondDb.SaveChangesAsync());
    }

    [Fact]
    public async Task A_demographic_answer_cannot_reference_a_field_that_does_not_exist()
    {
        // The other half of what the blob could not do: a jsonb key was free text,
        // so a typo'd or retired field name persisted silently. The FK makes an
        // unmapped answer impossible at the storage layer.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "FK Co", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var user = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "fk@fk.test", Name = "FK",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        db.UserDemographics.Add(new UserDemographic
        {
            UserId = user.Id, DemographicFieldId = Guid.NewGuid(), Value = "whatever",
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Existing_user_without_new_fields_still_loads_with_defaults()
    {
        // Simulates a row that existed BEFORE this migration ran (i.e. a #48-era user row):
        // run the migration first, then insert a row via raw SQL that only sets the pre-migration
        // (#48-era) columns, leaving every new column to whatever the DB-level column default is.
        // Reading it back via EF must show the intended domain defaults, proving those defaults are
        // baked into the migration's AddColumn calls (defaultValue: ...) rather than only existing as
        // C# object-initializer defaults that a legacy row would never pick up.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Legacy Co", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var minimalUserId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO users ("Id", company_id, email, name, role, is_active, created_at, updated_at)
             VALUES ({minimalUserId}, {company.Id}, {"legacy@acme.test"}, {"Legacy User"}, {"employee"}, {true}, {now}, {now})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.Users.SingleAsync(u => u.Id == minimalUserId);
        Assert.Null(loaded.DepartmentId);
        Assert.Null(loaded.ManagerId);
        Assert.Null(loaded.ConsentUpdatedAt);
        Assert.Empty(await readDb.UserDemographics.Where(d => d.UserId == minimalUserId).ToListAsync());
        Assert.Equal("en", loaded.Preferences.Language);
        Assert.Equal("UTC", loaded.Preferences.Timezone);
        Assert.Equal("default", loaded.Preferences.DashboardLayout);
        Assert.Equal("light", loaded.Preferences.Theme);
        Assert.True(loaded.Consent.Essential);
        Assert.False(loaded.Consent.Analytics);
        Assert.False(loaded.Consent.Marketing);
        Assert.False(loaded.Consent.Personalization);
        Assert.False(loaded.Consent.ThirdParty);
        Assert.False(loaded.Consent.Demographics);

        // The six legacy notification_settings preferences (#192). These must match legacy
        // User.ts NotificationSettingsSchema exactly: four email opt-outs true, push false,
        // digest 'weekly'. A legacy row imported by the ETL (#154) sets none of them, so any
        // divergence here re-subscribes users who had actually opted out.
        Assert.True(loaded.Notifications.EmailSurveys);
        Assert.True(loaded.Notifications.EmailMicroclimates);
        Assert.True(loaded.Notifications.EmailActionPlans);
        Assert.True(loaded.Notifications.EmailReminders);
        Assert.False(loaded.Notifications.PushNotifications);
        Assert.Equal("weekly", loaded.Notifications.DigestFrequency);
    }

    [Fact]
    public async Task Notification_preference_defaults_come_from_the_database_not_the_clr_initialiser()
    {
        // Companion to the test above, and the stronger half of the pair.
        //
        // Reading back through EF cannot tell "the DDL default filled the column" apart from
        // "the CLR object initializer supplied the value" for any preference whose legacy
        // default happens to equal the C# default -- which is all six, by construction, since
        // both are meant to be the legacy value. So this test never lets EF materialise a
        // NotificationPreferences at all: it inserts with raw SQL and reads the columns back
        // with raw SQL, leaving Postgres as the only possible source of every value.
        //
        // This is also what makes the pair a real guard rather than a tautology. Drop
        // HasDefaultValue from any of the six in UserConfiguration and this test fails
        // immediately and loudly: the columns stay NOT NULL, so the INSERT below -- which
        // names none of them -- throws instead of quietly falling back to a C# default.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company { Id = Guid.NewGuid(), Name = "Digest Co", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var userId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO users ("Id", company_id, email, name, role, is_active, created_at, updated_at)
             VALUES ({userId}, {company.Id}, {"digest@acme.test"}, {"Digest User"}, {"employee"}, {true}, {now}, {now})
             """);

        await using var readDb = CreateContext();

        Assert.True(await readDb.Database
            .SqlQuery<bool>($"""SELECT notifications_email_surveys AS "Value" FROM users WHERE "Id" = {userId}""")
            .SingleAsync());
        Assert.True(await readDb.Database
            .SqlQuery<bool>($"""SELECT notifications_email_microclimates AS "Value" FROM users WHERE "Id" = {userId}""")
            .SingleAsync());
        Assert.True(await readDb.Database
            .SqlQuery<bool>($"""SELECT notifications_email_action_plans AS "Value" FROM users WHERE "Id" = {userId}""")
            .SingleAsync());
        Assert.True(await readDb.Database
            .SqlQuery<bool>($"""SELECT notifications_email_reminders AS "Value" FROM users WHERE "Id" = {userId}""")
            .SingleAsync());
        Assert.False(await readDb.Database
            .SqlQuery<bool>($"""SELECT notifications_push AS "Value" FROM users WHERE "Id" = {userId}""")
            .SingleAsync());

        var digest = await readDb.Database
            .SqlQuery<string>($"""SELECT notifications_digest_frequency AS "Value" FROM users WHERE "Id" = {userId}""")
            .SingleAsync();
        Assert.Equal("weekly", digest);
        Assert.True(NotificationPreferenceValidation.IsValidDigestFrequency(digest));
    }
}
