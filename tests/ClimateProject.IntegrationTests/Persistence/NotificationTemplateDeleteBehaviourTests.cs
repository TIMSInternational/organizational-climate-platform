using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ClimateProject.IntegrationTests.Persistence;

/// <summary>
/// #168 follow-up. <c>notification_templates.created_by</c> was the one foreign key into
/// <c>users</c> anywhere in the schema with no explicit <c>OnDelete</c>, so it inherited EF Core's
/// default for a required relationship — <b>CASCADE</b> — while every sibling actor column
/// (<c>ActionPlanConfiguration</c>, <c>ActionPlanTemplateConfiguration</c>,
/// <c>BenchmarkConfiguration</c>, and the rest) spells out <c>Restrict</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why it mattered even though it could not fire.</b> Nothing hard-deletes a user today: GDPR
/// erasure pseudonymises the row (<c>SubjectDataMap.cs</c>, <c>User</c> →
/// <c>ErasureTreatment.Anonymised</c>) and there is no user DELETE endpoint. So the CASCADE was
/// latent rather than live. The trap was that it would open silently the first time anyone added
/// a hard delete: the other columns would refuse the delete and this one would quietly take
/// company-wide notification templates with it — configuration the deleted person authored but
/// did not own.
/// </para>
/// <para>
/// <b>Why this is a database assertion.</b> The behaviour under test belongs to the constraint,
/// not to any C# a request runs, so the delete goes through a context that has loaded nothing but
/// the user. That keeps EF's client-side fixup from standing in for Postgres and turning a schema
/// that would have cascaded into a green test.
/// </para>
/// <para>
/// This test fails if the constraint is ever returned to CASCADE — which is the point. The
/// argument for RESTRICT is recorded in <c>docs/decisions/survey-foreign-keys.md</c>; changing it
/// back should have to rewrite that argument and not merely the schema.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class NotificationTemplateDeleteBehaviourTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<(Company company, User user)> SeedCompanyAndUserAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "TemplateAcme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var user = new User
        {
            Id = Guid.NewGuid(),
            CompanyId = company.Id,
            Email = $"tpl-author-{Guid.NewGuid():N}@tplacme.test",
            Name = "Template Author",
            Role = "company_admin",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (company, user);
    }

    private static NotificationTemplate NewTemplate(Guid companyId, Guid createdBy) => new()
    {
        Id = Guid.NewGuid(),
        Name = "Survey invitation",
        Type = "survey_invitation",
        Channel = "email",
        SubjectEn = "You have a survey to complete",
        SubjectEs = "Tienes una encuesta por completar",
        CompanyId = companyId,
        CreatedBy = createdBy,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    public async Task Deleting_the_author_of_a_notification_template_is_refused()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, user) = await SeedCompanyAndUserAsync(db);

        var template = NewTemplate(company.Id, user.Id);
        db.NotificationTemplates.Add(template);
        await db.SaveChangesAsync();

        // The attack: delete the author. Under the CASCADE this column carried until #168, this
        // succeeds and the template disappears. Under RESTRICT the database refuses it.
        var ex = await Assert.ThrowsAsync<DbUpdateException>(async () =>
        {
            await using var deleteContext = CreateContext();
            var author = await deleteContext.Users.SingleAsync(u => u.Id == user.Id);
            deleteContext.Users.Remove(author);
            await deleteContext.SaveChangesAsync();
        });

        var pg = Assert.IsType<PostgresException>(ex.InnerException);
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, pg.SqlState);

        // And the template is still there. Asserting the refusal alone would pass against a
        // schema that raised on the delete and destroyed the row anyway.
        await using var check = CreateContext();
        Assert.True(await check.NotificationTemplates.AnyAsync(t => t.Id == template.Id));
    }

    [Fact]
    public async Task A_template_naming_no_author_is_rejected()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var (company, _) = await SeedCompanyAndUserAsync(db);

        // The constraint is a real foreign key, not merely a delete rule. Without this, the test
        // above would still pass on a schema whose only enforcement was the ON DELETE clause.
        db.NotificationTemplates.Add(NewTemplate(company.Id, Guid.NewGuid()));

        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(ex.InnerException);
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, pg.SqlState);
    }
}
