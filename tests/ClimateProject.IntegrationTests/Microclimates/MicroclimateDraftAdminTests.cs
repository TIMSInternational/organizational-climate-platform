using System.Net;
using System.Net.Http.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Microclimates;

/// <summary>
/// The administrator's half of G23: a draft's content can be replaced under create's own
/// validation, a draft can be discarded, the company's microclimate seats can be read by its own
/// administrators, and the invitation list pages past its first 500 rows.
/// </summary>
/// <remarks>
/// End-to-end against Postgres because two of the guarantees are about rows the database holds
/// afterwards: a replaced draft keeps none of its old questions or options, and a discarded one
/// leaves no questions behind.
/// </remarks>
[Collection("Postgres")]
public class MicroclimateDraftAdminTests : IAsyncLifetime
{
    private readonly SurveyTestHarness _harness;
    private Guid _companyAId;
    private Guid _companyBId;

    public MicroclimateDraftAdminTests(PostgresContainerFixture postgres)
    {
        _harness = new SurveyTestHarness(postgres.App, $"mcdraft-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyAId = await _harness.SeedCompanyAsync("Microclimate Draft Co A");
        _companyBId = await _harness.SeedCompanyAsync("Microclimate Draft Co B");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<HttpClient> AdminAAsync() => _harness.ClientAsync(Roles.CompanyAdmin, _companyAId);

    private static CreateMicroclimateRequest DraftRequest(Guid companyId) => new(
        LocalizedInput.FromBare("Original title"),
        LocalizedInput.FromBare("Original description"),
        companyId,
        DateTimeOffset.UtcNow.AddHours(1),
        DateTimeOffset.UtcNow.AddHours(3),
        TargetParticipantCount: 12,
        AnonymousResponses: true,
        TemplateId: null,
        Questions:
        [
            new CreateQuestionInput("How is the week going?", "open_ended", null, true, 1),
            new CreateQuestionInput(
                "Pick one",
                "multiple_choice",
                [new CreateQuestionOptionInput(null, "Yes"), new CreateQuestionOptionInput(null, "No")],
                false,
                2),
        ],
        Language: "en");

    private static async Task<MicroclimateDetail> CreateDraftAsync(HttpClient admin, Guid companyId)
    {
        var response = await admin.PostAsJsonAsync("/microclimates", DraftRequest(companyId));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<MicroclimateDetail>())!;
    }

    private static ReplaceMicroclimateContentRequest Replacement(
        List<CreateQuestionInput>? questions = null,
        DateTimeOffset? start = null,
        DateTimeOffset? end = null) => new(
        LocalizedInput.FromBare("Edited title"),
        LocalizedInput.FromBare("Edited description"),
        start ?? DateTimeOffset.UtcNow.AddDays(1),
        end ?? DateTimeOffset.UtcNow.AddDays(1).AddHours(2),
        TargetParticipantCount: 30,
        AnonymousResponses: false,
        Questions: questions ??
        [
            new CreateQuestionInput(
                "How do you feel?",
                "emoji_rating",
                null,
                true,
                1,
                [
                    new CreateQuestionEmojiOptionInput("\U0001F622", null, "Bad"),
                    new CreateQuestionEmojiOptionInput("\U0001F642", null, "Good"),
                ]),
        ]);

    private Task ForceStatusAsync(Guid id, string status, int responseCount = 0)
        => _harness.WithDbAsync(async db =>
        {
            var row = await db.Microclimates.SingleAsync(m => m.Id == id);
            row.Status = status;
            row.ResponseCount = responseCount;
            await db.SaveChangesAsync();
        });

    private Task<int> QuestionRowsAsync(Guid microclimateId)
        => _harness.WithDbAsync(db => db.MicroclimateQuestions.CountAsync(q => q.MicroclimateId == microclimateId));

    private Task<int> OptionRowsAsync(Guid microclimateId)
        => _harness.WithDbAsync(db => db.MicroclimateQuestionOptions
            .CountAsync(o => db.MicroclimateQuestions.Any(q => q.Id == o.MicroclimateQuestionId && q.MicroclimateId == microclimateId)));

    // ------------------------------------------------------------------
    // Draft content
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_drafts_whole_content_is_replaced_and_its_old_questions_are_gone()
    {
        var admin = await AdminAAsync();
        var draft = await CreateDraftAsync(admin, _companyAId);
        Assert.Equal(2, await OptionRowsAsync(draft.Id));

        var replacement = Replacement();
        var response = await admin.PutAsJsonAsync($"/microclimates/{draft.Id}/content", replacement);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = (await (await admin.GetAsync($"/microclimates/{draft.Id}")).Content.ReadFromJsonAsync<MicroclimateDetail>())!;
        Assert.Equal("Edited title", detail.Title);
        Assert.Equal("Edited description", detail.Description);
        Assert.Equal(30, detail.TargetParticipantCount);
        Assert.False(detail.AnonymousResponses);
        Assert.Equal(replacement.StartTime.ToUnixTimeSeconds(), detail.StartTime.ToUnixTimeSeconds());
        Assert.Equal(replacement.EndTime.ToUnixTimeSeconds(), detail.EndTime.ToUnixTimeSeconds());
        Assert.Equal(MicroclimateStatuses.Draft, detail.Status);
        var question = Assert.Single(detail.Questions);
        Assert.Equal("emoji_rating", question.Type);
        Assert.Equal(2, question.EmojiOptions!.Count);

        // The rows, not the DTO: the two old questions and the multiple-choice options went.
        Assert.Equal(1, await QuestionRowsAsync(draft.Id));
        Assert.Equal(0, await OptionRowsAsync(draft.Id));
    }

    [Fact]
    public async Task Replacing_a_drafts_content_runs_creates_validation_and_a_refusal_changes_nothing()
    {
        var admin = await AdminAAsync();
        var draft = await CreateDraftAsync(admin, _companyAId);

        var oneOption = await admin.PutAsJsonAsync($"/microclimates/{draft.Id}/content", Replacement(
        [
            new CreateQuestionInput("Pick", "multiple_choice", [new CreateQuestionOptionInput(null, "Only")], true, 1),
        ]));
        Assert.Equal(HttpStatusCode.BadRequest, oneOption.StatusCode);
        Assert.Contains("multiple_choice questions require at least 2 options", await oneOption.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var start = DateTimeOffset.UtcNow.AddDays(2);
        var transposed = await admin.PutAsJsonAsync($"/microclimates/{draft.Id}/content", Replacement(start: start, end: start.AddHours(-1)));
        Assert.Equal(HttpStatusCode.BadRequest, transposed.StatusCode);

        var badType = await admin.PutAsJsonAsync($"/microclimates/{draft.Id}/content", Replacement(
        [
            new CreateQuestionInput("Huh", "not_a_type", null, true, 1),
        ]));
        Assert.Equal(HttpStatusCode.BadRequest, badType.StatusCode);

        var detail = (await (await admin.GetAsync($"/microclimates/{draft.Id}")).Content.ReadFromJsonAsync<MicroclimateDetail>())!;
        Assert.Equal("Original title", detail.Title);
        Assert.Equal(2, detail.Questions.Count);
        Assert.Equal(2, await QuestionRowsAsync(draft.Id));
    }

    [Theory]
    [InlineData(MicroclimateStatuses.Active)]
    [InlineData(MicroclimateStatuses.Closed)]
    public async Task A_launched_microclimates_content_cannot_be_replaced(string status)
    {
        var admin = await AdminAAsync();
        var draft = await CreateDraftAsync(admin, _companyAId);
        await ForceStatusAsync(draft.Id, status);

        var response = await admin.PutAsJsonAsync($"/microclimates/{draft.Id}/content", Replacement());

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(2, await QuestionRowsAsync(draft.Id));
    }

    [Fact]
    public async Task A_draft_that_has_counted_a_response_is_not_editable_or_discardable()
    {
        var admin = await AdminAAsync();
        var draft = await CreateDraftAsync(admin, _companyAId);
        await ForceStatusAsync(draft.Id, MicroclimateStatuses.Draft, responseCount: 1);

        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/microclimates/{draft.Id}/content", Replacement())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/microclimates/{draft.Id}")).StatusCode);
    }

    [Fact]
    public async Task Another_tenants_admin_and_an_employee_cannot_edit_or_discard_a_draft()
    {
        var admin = await AdminAAsync();
        var draft = await CreateDraftAsync(admin, _companyAId);
        var otherAdmin = await _harness.ClientAsync(Roles.CompanyAdmin, _companyBId);
        var employee = await _harness.ClientAsync(Roles.Employee, _companyAId);

        Assert.Equal(HttpStatusCode.Forbidden, (await otherAdmin.PutAsJsonAsync($"/microclimates/{draft.Id}/content", Replacement())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherAdmin.DeleteAsync($"/microclimates/{draft.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.PutAsJsonAsync($"/microclimates/{draft.Id}/content", Replacement())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employee.DeleteAsync($"/microclimates/{draft.Id}")).StatusCode);
        Assert.Equal(2, await QuestionRowsAsync(draft.Id));
    }

    // ------------------------------------------------------------------
    // Discarding a draft
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_draft_is_discarded_with_its_questions()
    {
        var admin = await AdminAAsync();
        var draft = await CreateDraftAsync(admin, _companyAId);

        var response = await admin.DeleteAsync($"/microclimates/{draft.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/microclimates/{draft.Id}")).StatusCode);
        Assert.Equal(0, await QuestionRowsAsync(draft.Id));
    }

    [Theory]
    [InlineData(MicroclimateStatuses.Active)]
    [InlineData(MicroclimateStatuses.Closed)]
    public async Task A_launched_microclimate_cannot_be_discarded(string status)
    {
        var admin = await AdminAAsync();
        var draft = await CreateDraftAsync(admin, _companyAId);
        await ForceStatusAsync(draft.Id, status);

        var response = await admin.DeleteAsync($"/microclimates/{draft.Id}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/microclimates/{draft.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_draft_somebody_was_invited_to_cannot_be_discarded()
    {
        var admin = await AdminAAsync();
        var draft = await CreateDraftAsync(admin, _companyAId);
        await _harness.WithDbAsync(async db =>
        {
            var userId = await db.Users.Where(u => u.CompanyId == _companyAId).Select(u => u.Id).FirstAsync();
            db.MicroclimateInvitations.Add(new MicroclimateInvitation
            {
                Id = Guid.NewGuid(),
                MicroclimateId = draft.Id,
                UserId = userId,
                CompanyId = _companyAId,
                Email = "invitee@invitee.test",
                InvitationToken = Guid.NewGuid().ToString("N"),
                ExpiresAt = DateTimeOffset.UtcNow.AddDays(1),
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

        var response = await admin.DeleteAsync($"/microclimates/{draft.Id}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(2, await QuestionRowsAsync(draft.Id));
    }

    // ------------------------------------------------------------------
    // Seats
    // ------------------------------------------------------------------

    private Task GrantAsync(Guid companyId, int seats, int used = 0)
        => _harness.WithDbAsync(async db =>
        {
            await CompanyLicenses.GrantOrUpdateAsync(db, companyId, ClimateServiceTypes.Microclimate, seats, null, DateTimeOffset.UtcNow, default);
            var licence = await db.CompanyServiceLicenses.SingleAsync(l => l.CompanyId == companyId && l.ServiceType == ClimateServiceTypes.Microclimate);
            licence.SeatsUsed = used;
            await db.SaveChangesAsync();
        });

    [Fact]
    public async Task A_company_admin_reads_their_own_microclimate_seats()
    {
        await GrantAsync(_companyAId, seats: 50, used: 12);
        var admin = await AdminAAsync();

        var seats = await admin.GetFromJsonAsync<MicroclimateSeatsView>("/microclimates/seats");

        Assert.Equal(new MicroclimateSeatsView(true, LicenseStatuses.Active, 50, 12, 38), seats);
        Assert.Equal(seats, await admin.GetFromJsonAsync<MicroclimateSeatsView>($"/microclimates/seats?companyId={_companyAId}"));
    }

    [Fact]
    public async Task An_unlicensed_company_reads_as_unmetered_and_an_exhausted_one_as_zero_remaining()
    {
        var admin = await AdminAAsync();
        Assert.Equal(
            new MicroclimateSeatsView(false, LicenseStatuses.Active, 0, 0, 0),
            await admin.GetFromJsonAsync<MicroclimateSeatsView>("/microclimates/seats"));

        await GrantAsync(_companyAId, seats: 5, used: 7);
        var exhausted = await admin.GetFromJsonAsync<MicroclimateSeatsView>("/microclimates/seats");
        Assert.Equal(0, exhausted!.SeatsRemaining);
        Assert.True(exhausted.Licensed);
    }

    [Fact]
    public async Task Seats_are_read_only_within_the_callers_own_tenant_except_by_a_super_admin()
    {
        await GrantAsync(_companyBId, seats: 9, used: 1);
        var adminA = await AdminAAsync();
        var employeeB = await _harness.ClientAsync(Roles.Employee, _companyBId);
        var superAdmin = await _harness.ClientAsync(Roles.SuperAdmin, null);

        Assert.Equal(HttpStatusCode.Forbidden, (await adminA.GetAsync($"/microclimates/seats?companyId={_companyBId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await employeeB.GetAsync("/microclimates/seats")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await superAdmin.GetAsync("/microclimates/seats")).StatusCode);
        Assert.Equal(
            new MicroclimateSeatsView(true, LicenseStatuses.Active, 9, 1, 8),
            await superAdmin.GetFromJsonAsync<MicroclimateSeatsView>($"/microclimates/seats?companyId={_companyBId}"));
    }

    // ------------------------------------------------------------------
    // The whole invitation list
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_invitation_list_pages_past_its_first_page_without_repeating_a_row()
    {
        var admin = await AdminAAsync();
        var draft = await CreateDraftAsync(admin, _companyAId);
        await ForceStatusAsync(draft.Id, MicroclimateStatuses.Active);
        const int total = 503;
        await _harness.WithDbAsync(async db =>
        {
            // One CreatedAt for all of them, as one batch is minted: the page order must not
            // depend on it alone.
            var now = DateTimeOffset.UtcNow;
            for (var i = 0; i < total; i++)
            {
                var user = new User
                {
                    Id = Guid.NewGuid(),
                    CompanyId = _companyAId,
                    Email = $"{Guid.NewGuid():N}@invitee.test",
                    Name = "Invitee",
                    Role = Roles.Employee,
                    IsActive = true,
                    CreatedAt = now,
                };
                db.Users.Add(user);
                db.MicroclimateInvitations.Add(new MicroclimateInvitation
                {
                    Id = Guid.NewGuid(),
                    MicroclimateId = draft.Id,
                    UserId = user.Id,
                    CompanyId = _companyAId,
                    Email = user.Email,
                    InvitationToken = Guid.NewGuid().ToString("N"),
                    ExpiresAt = now.AddDays(1),
                    CreatedAt = now,
                    UpdatedAt = now,
                });
            }

            await db.SaveChangesAsync();
        });

        var first = await admin.GetFromJsonAsync<MicroclimateInvitationListResponse>($"/microclimates/{draft.Id}/invitations");
        var second = await admin.GetFromJsonAsync<MicroclimateInvitationListResponse>($"/microclimates/{draft.Id}/invitations?offset=500");

        Assert.Equal(500, first!.Invitations.Count);
        Assert.Equal(3, second!.Invitations.Count);
        Assert.Equal(total, first.Summary.Total);
        Assert.Equal(total, first.Invitations.Concat(second.Invitations).Select(i => i.Id).Distinct().Count());
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"/microclimates/{draft.Id}/invitations?offset=-1")).StatusCode);
    }
}
