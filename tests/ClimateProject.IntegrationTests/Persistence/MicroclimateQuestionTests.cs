using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Persistence;

[Collection("Postgres")]
public class MicroclimateQuestionTests(PostgresContainerFixture postgres)
{
    private ClimateProjectDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ClimateProjectDbContext>()
            .UseNpgsql(postgres.ConnectionString)
            .Options;
        return new ClimateProjectDbContext(options);
    }

    private async Task<Microclimate> SeedMicroclimateAsync(ClimateProjectDbContext db)
    {
        var company = new Company { Id = Guid.NewGuid(), Name = "Acme", CreatedAt = DateTimeOffset.UtcNow };
        db.Companies.Add(company);
        var creator = new User
        {
            Id = Guid.NewGuid(), CompanyId = company.Id, Email = $"creator-{Guid.NewGuid():N}@acme.test", Name = "Creator",
            Role = "company_admin", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.Users.Add(creator);
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
        return microclimate;
    }

    [Fact]
    public async Task Question_round_trips_with_options_and_ordering()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var question = new MicroclimateQuestion
        {
            Id = Guid.NewGuid(),
            MicroclimateId = microclimate.Id,
            TextEn = "How satisfied are you this week?",
            Type = "multiple_choice",
            Order = 1,
        };
        db.MicroclimateQuestions.Add(question);
        // Options are rows carrying a stable, locale-independent value (#195) -- what a
        // respondent submits and what question_responses stores, never the label.
        string[] optionValues = ["Very", "Somewhat", "Not really"];
        for (var order = 0; order < optionValues.Length; order++)
        {
            db.MicroclimateQuestionOptions.Add(new MicroclimateQuestionOption
            {
                MicroclimateQuestionId = question.Id,
                Order = order,
                Value = optionValues[order],
                LabelEn = optionValues[order],
            });
        }

        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateQuestions.SingleAsync(q => q.Id == question.Id);
        Assert.Equal(microclimate.Id, loaded.MicroclimateId);
        Assert.Equal("multiple_choice", loaded.Type);
        var loadedOptions = await readDb.MicroclimateQuestionOptions
            .Where(o => o.MicroclimateQuestionId == question.Id)
            .OrderBy(o => o.Order)
            .ToListAsync();
        Assert.Equal(optionValues, loadedOptions.Select(o => o.Value));
        Assert.True(loaded.Required);
        Assert.Equal(1, loaded.Order);
    }

    [Fact]
    public async Task Deleting_microclimate_cascades_to_its_questions()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var question = new MicroclimateQuestion
        {
            Id = Guid.NewGuid(), MicroclimateId = microclimate.Id, TextEn = "Q", Type = "open_ended", Order = 1,
        };
        db.MicroclimateQuestions.Add(question);
        await db.SaveChangesAsync();

        db.Microclimates.Remove(microclimate);
        await db.SaveChangesAsync();

        await using var readDb = CreateContext();
        Assert.False(await readDb.MicroclimateQuestions.AnyAsync(q => q.Id == question.Id));
    }

    [Fact]
    public async Task Minimal_row_inserted_via_raw_SQL_still_loads_with_true_intended_default_for_required()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var microclimate = await SeedMicroclimateAsync(db);

        var minimalId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO microclimate_questions ("Id", microclimate_id, text_en, type, question_order)
             VALUES ({minimalId}, {microclimate.Id}, {"Minimal question"}, {"likert"}, {1})
             """);

        await using var readDb = CreateContext();
        var loaded = await readDb.MicroclimateQuestions.SingleAsync(q => q.Id == minimalId);
        Assert.True(loaded.Required);
        Assert.Empty(await readDb.MicroclimateQuestionOptions.Where(o => o.MicroclimateQuestionId == minimalId).ToListAsync());
    }
}
