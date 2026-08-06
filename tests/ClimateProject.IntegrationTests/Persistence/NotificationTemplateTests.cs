using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class NotificationTemplateTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User creator)> SeedCompanyAndCreatorAsync(ClimateProjectDbContext db, string emailSuffix)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"notiftemplate-admin-{emailSuffix}@acme.test", Name = "Admin",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        db.Users.Add(creator);
        await db.SaveChangesAsync();
        return (company, creator);
    }

    [Fact]
    public async Task NotificationTemplate_round_trips_with_variables_and_personalization_rules()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator) = await SeedCompanyAndCreatorAsync(db, "1");

        var template = new NotificationTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Survey Invitation - Company Branded",
            Type = "survey_invitation",
            Channel = "email",
            SubjectEn = "You're invited: {{survey_name}}",
            TitleEn = "New survey",
            ContentEn = "Hi {{user_name}}, please complete {{survey_name}}.",
            HtmlContentEn = "<p>Hi {{user_name}}, please complete {{survey_name}}.</p>",
            CompanyId = company.Id,
            IsActive = true,
            IsDefault = false,
            CreatedBy = creator.Id,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.NotificationTemplates.Add(template);
        await db.SaveChangesAsync();

        var variable = new NotificationTemplateVariable
        {
            Id = Guid.NewGuid(),
            NotificationTemplateId = template.Id,
            Name = "survey_name",
            Type = "string",
            Required = true,
            Description = "The name of the survey being sent",
            DefaultValue = """{"fallback": "Climate Survey"}""",
        };
        var rule = new NotificationPersonalizationRule
        {
            Id = Guid.NewGuid(),
            NotificationTemplateId = template.Id,
            Condition = "user.role === 'leader'",
            Modifications = """{"title": "Leader survey reminder"}""",
        };
        db.NotificationTemplateVariables.Add(variable);
        db.NotificationPersonalizationRules.Add(rule);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loadedTemplate = await readDb.NotificationTemplates.SingleAsync(t => t.Id == template.Id);
        Assert.Equal("survey_invitation", loadedTemplate.Type);
        Assert.Equal(company.Id, loadedTemplate.CompanyId);
        Assert.Equal(creator.Id, loadedTemplate.CreatedBy);

        var loadedVariable = await readDb.NotificationTemplateVariables.SingleAsync(v => v.Id == variable.Id);
        Assert.True(loadedVariable.Required);
        Assert.Contains("Climate Survey", loadedVariable.DefaultValue);

        var loadedRule = await readDb.NotificationPersonalizationRules.SingleAsync(r => r.Id == rule.Id);
        Assert.Contains("leader", loadedRule.Condition);
        Assert.Contains("Leader survey reminder", loadedRule.Modifications);
    }

    [Fact]
    public async Task Minimal_template_and_variable_inserted_via_raw_SQL_still_load_with_DB_level_defaults()
    {
        // Proves is_active/is_default (NotificationTemplate) and required (NotificationTemplateVariable)
        // are real Postgres column defaults, not just C# object-initializer defaults a raw-SQL
        // insert would never see.
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator) = await SeedCompanyAndCreatorAsync(db, "2");

        var minimalTemplateId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO notification_templates ("Id", name, type, channel, title_en, content_en, created_by, created_at, updated_at)
             VALUES ({minimalTemplateId}, {"Minimal Template"}, {"system_notification"}, {"in_app"}, {"Notice"}, {"Body text"}, {creator.Id}, {now}, {now})
             """);

        var minimalVariableId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO notification_template_variables ("Id", notification_template_id, name, type, description)
             VALUES ({minimalVariableId}, {minimalTemplateId}, {"user_name"}, {"string"}, {"The recipient's display name"})
             """);

        await using var readDb = CreateContext();
        var loadedTemplate = await readDb.NotificationTemplates.SingleAsync(t => t.Id == minimalTemplateId);
        Assert.True(loadedTemplate.IsActive);
        Assert.False(loadedTemplate.IsDefault);
        Assert.Null(loadedTemplate.CompanyId);
        Assert.Null(loadedTemplate.SubjectEn);

        var loadedVariable = await readDb.NotificationTemplateVariables.SingleAsync(v => v.Id == minimalVariableId);
        Assert.False(loadedVariable.Required);
        Assert.Null(loadedVariable.DefaultValue);
    }

    [Fact]
    public async Task Notification_TemplateId_references_notification_templates_after_the_retrofitted_FK()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, creator) = await SeedCompanyAndCreatorAsync(db, "3");

        var template = new NotificationTemplate
        {
            Id = Guid.NewGuid(), Name = "Deadline reminder", Type = "deadline_reminder", Channel = "in_app",
            TitleEn = "Deadline approaching", ContentEn = "Your deadline is near.", CreatedBy = creator.Id,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.NotificationTemplates.Add(template);

        var recipient = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = "recipient@acme.test", Name = "Recipient",
            Role = "employee", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(recipient);
        await db.SaveChangesAsync();

        var notification = new Notification
        {
            Id = Guid.NewGuid(), UserId = recipient.Id, CompanyId = company.Id, Type = "deadline_reminder",
            Channel = "in_app", Title = "Deadline approaching", Message = "Your deadline is near.",
            TemplateId = template.Id, ScheduledFor = DateTimeOffset.UtcNow,
            CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Notifications.Add(notification);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.Notifications.SingleAsync(n => n.Id == notification.Id);
        Assert.Equal(template.Id, loaded.TemplateId);

        // Deleting the template should SetNull the notification's TemplateId, not cascade-delete it.
        await using var deleteDb = CreateContext();
        var templateToDelete = await deleteDb.NotificationTemplates.SingleAsync(t => t.Id == template.Id);
        deleteDb.NotificationTemplates.Remove(templateToDelete);
        await deleteDb.SaveChangesAsync();

        await using var verifyDb = CreateContext();
        var stillThere = await verifyDb.Notifications.SingleAsync(n => n.Id == notification.Id);
        Assert.Null(stillThere.TemplateId);
    }
}
