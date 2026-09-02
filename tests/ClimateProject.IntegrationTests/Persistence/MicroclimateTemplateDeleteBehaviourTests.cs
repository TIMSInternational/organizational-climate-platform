using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

/// <summary>
/// #168 follow-up. <c>microclimate_templates.company_id</c> was the only <c>company_id</c> in the
/// schema with a defaulted <c>onDelete</c> — Postgres applied <c>NO ACTION</c> — while all seven
/// sibling global tables (<c>survey_templates</c>, <c>action_plan_templates</c>,
/// <c>benchmarks</c>, <c>notification_templates</c>, <c>question_bank_items</c>,
/// <c>question_categories</c>, <c>question_library_items</c>) pin <c>SET NULL</c>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why NO ACTION bought nothing here.</b> The column is nullable — a null <c>company_id</c> is
/// how this table already spells "global template". So the old behaviour did not protect the row;
/// it only guaranteed that a tenant purge would <c>SET NULL</c> the seven siblings and then abort
/// on this one, leaving the delete half-applied. <c>SET NULL</c> turns the template into the thing
/// it was always allowed to be.
/// </para>
/// <para>
/// <b>Why the company under test owns nothing else.</b> A company is referenced by a great many
/// tables, several of them <c>RESTRICT</c>. If the fixture attached a user or a survey to it, the
/// delete below would fail for a reason that has nothing to do with this constraint and the test
/// would be red for the wrong cause. <c>CreatedBy</c> is nullable and is left null for the same
/// reason.
/// </para>
/// </remarks>
[Collection("Postgres")]
public class MicroclimateTemplateDeleteBehaviourTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    [Fact]
    public async Task Deleting_a_company_keeps_its_microclimate_template_and_makes_it_global()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();

        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "MicroAcme",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        await db.SaveChangesAsync();

        var template = new MicroclimateTemplate
        {
            Id = Guid.NewGuid(),
            Name = "Pulse check",
            Description = "A short weekly pulse",
            Category = "engagement",
            CompanyId = company.Id,
            CreatedBy = null,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.MicroclimateTemplates.Add(template);
        await db.SaveChangesAsync();

        // The attack: purge the tenant. Under the defaulted NO ACTION this throws a foreign-key
        // violation and the purge stops half-done; under SET NULL it succeeds.
        await using (var deleteContext = CreateContext())
        {
            var doomed = await deleteContext.Companies.SingleAsync(c => c.Id == company.Id);
            deleteContext.Companies.Remove(doomed);
            await deleteContext.SaveChangesAsync();
        }

        // Survived, and became global rather than dangling. Asserting the delete succeeded alone
        // would also pass against a CASCADE that took the template with it.
        await using var check = CreateContext();
        var survivor = await check.MicroclimateTemplates.SingleOrDefaultAsync(t => t.Id == template.Id);
        Assert.NotNull(survivor);
        Assert.Null(survivor.CompanyId);
    }
}
