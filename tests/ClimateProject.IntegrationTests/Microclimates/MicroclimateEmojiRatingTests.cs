using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClimateProject.Api.Endpoints;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Microclimates;
using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;
using ClimateProject.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace ClimateProject.IntegrationTests.Microclimates;

/// <summary>
/// <c>emoji_rating</c> on a microclimate, end to end (#198).
///
/// <para>
/// The type was canonical and deliberately refused on this surface because a
/// microclimate question had nowhere to store an emoji set. Every test here is against
/// one of the issue's acceptance criteria, and each one goes through the real HTTP write
/// path rather than seeding rows: the criterion is "an admin can author this and a
/// respondent can answer it", and a fixture built by hand would prove neither.
/// </para>
/// </summary>
[Collection("Postgres")]
public class MicroclimateEmojiRatingTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly string _domain = $"emoji-{Guid.NewGuid():N}.test";
    private Guid _companyId;

    public MicroclimateEmojiRatingTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
    }

    public async Task InitializeAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var company = new Company
        {
            Id = Guid.NewGuid(),
            Name = "Emoji Co",
            EmailDomain = _domain,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Companies.Add(company);
        _companyId = company.Id;
        await db.SaveChangesAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = _factory.CreateClient();
        var email = $"{Guid.NewGuid():N}@{_domain}";
        var signup = await client.PostAsJsonAsync("/auth/signup", new SignupRequest("Admin", email, "A-good-passw0rd"));
        var token = (await signup.Content.ReadFromJsonAsync<TokenResponse>())!.Token;

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var user = await db.Users.FirstAsync(u => u.Email == email);
            user.Role = Roles.CompanyAdmin;
            user.CompanyId = _companyId;
            await db.SaveChangesAsync();
        }

        var login = await client.PostAsJsonAsync("/auth/login", new LoginRequest(email, "A-good-passw0rd"));
        var fresh = (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", fresh);
        return client;
    }

    private static LocalizedInput Both(string en, string es)
        => LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = en, ["es"] = es });

    /// <summary>A four-point scale with a name on every face. Values default to 1..4.</summary>
    private static List<CreateQuestionEmojiOptionInput> FourFaces() =>
    [
        new("\U0001F622", null, "Sad"),
        new("\U0001F610", null, "Neutral"),
        new("\U0001F642", null, "Good"),
        new("\U0001F929", null, "Great"),
    ];

    private Task<HttpResponseMessage> PostMicroclimateAsync(
        HttpClient client,
        LocalizedInput title,
        List<CreateQuestionInput>? questions,
        string? language = null)
        => client.PostAsJsonAsync("/microclimates", new CreateMicroclimateRequest(
            Title: title,
            Description: null,
            CompanyId: _companyId,
            StartTime: DateTimeOffset.UtcNow,
            EndTime: DateTimeOffset.UtcNow.AddHours(1),
            TargetParticipantCount: 5,
            AnonymousResponses: true,
            TemplateId: null,
            Questions: questions,
            Language: language));

    // ------------------------------------------------------------------
    // Criterion: emoji options storable per microclimate question
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_emoji_scale_is_stored_and_read_back_with_its_glyphs_values_and_names()
    {
        var client = await AdminClientAsync();

        var createResponse = await PostMicroclimateAsync(client, "Pulse with faces",
            [new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1, FourFaces())]);

        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<MicroclimateDetail>();

        // Read it back through GET rather than trusting the POST's echo: the criterion is
        // that the scale is STORED, and only a second request proves the rows survived.
        var fetched = await (await client.GetAsync($"/microclimates/{created!.Id}"))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        var question = Assert.Single(fetched!.Questions);
        Assert.Equal("emoji_rating", question.Type);
        // The plain option list stays null -- this scale is not smuggled through Options[],
        // which is the shape #198 explicitly rejected.
        Assert.Null(question.Options);

        var scale = question.EmojiOptions;
        Assert.NotNull(scale);
        Assert.Equal(4, scale!.Count);
        Assert.Equal([0, 1, 2, 3], scale.Select(o => o.Order));
        Assert.Equal(["\U0001F622", "\U0001F610", "\U0001F642", "\U0001F929"], scale.Select(o => o.Emoji));
        // Values default to the 1-based position, so an author who just lists faces gets 1..4.
        Assert.Equal([1, 2, 3, 4], scale.Select(o => o.Value));
        Assert.Equal(["Sad", "Neutral", "Good", "Great"], scale.Select(o => o.Label));
    }

    [Fact]
    public async Task Explicit_values_are_kept_rather_than_renumbered_by_position()
    {
        var client = await AdminClientAsync();

        // A scale centred on zero. Nothing may quietly rewrite these to 1..3: the value is
        // what lands in the stored answer, so renumbering would change what past answers mean.
        var created = await (await PostMicroclimateAsync(client, "Signed scale",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new("\U0001F622", -1, "Bad"),
                new("\U0001F610", 0, "Neutral"),
                new("\U0001F642", 1, "Good"),
            ]),
        ])).Content.ReadFromJsonAsync<MicroclimateDetail>();

        var scale = created!.Questions.Single().EmojiOptions;
        Assert.Equal([-1, 0, 1], scale!.Select(o => o.Value));
    }

    [Fact]
    public async Task The_scale_is_served_to_an_anonymous_respondent_too()
    {
        var client = await AdminClientAsync();
        var created = await (await PostMicroclimateAsync(client, "Public pulse",
                [new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1, FourFaces())]))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        // No token at all -- this is the reduced payload the public respond page reads. A
        // scale that only an admin can see is a question nobody can answer.
        var anonymous = _factory.CreateClient();
        var publicDetail = await (await anonymous.GetAsync($"/microclimates/{created.Id}"))
            .Content.ReadFromJsonAsync<PublicMicroclimateDetail>();

        var scale = publicDetail!.Questions.Single().EmojiOptions;
        Assert.NotNull(scale);
        Assert.Equal(["Sad", "Neutral", "Good", "Great"], scale!.Select(o => o.Label));
    }

    // ------------------------------------------------------------------
    // Criterion: rendered with an accessible name for each option
    // (server half -- the label is required, per locale, and never falls to the glyph)
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_emoji_option_without_a_label_is_refused_because_it_would_have_no_accessible_name()
    {
        var client = await AdminClientAsync();

        var response = await PostMicroclimateAsync(client, "Nameless faces",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new("\U0001F622", null, null),
                new("\U0001F642", null, null),
            ]),
        ]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var message = await response.Content.ReadAsStringAsync();
        Assert.Contains("accessible name", message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_bilingual_scale_is_served_in_the_requested_locale()
    {
        var client = await AdminClientAsync();

        var bilingual = await (await PostMicroclimateAsync(client, Both("Pulse", "Pulso"),
        [
            new CreateQuestionInput(Both("How was your week?", "¿Cómo estuvo tu semana?"), "emoji_rating", null, true, 1,
            [
                new("\U0001F622", null, Both("Sad", "Triste")),
                new("\U0001F642", null, Both("Good", "Bien")),
            ]),
        ], language: "both")).Content.ReadFromJsonAsync<MicroclimateDetail>();

        var spanish = await (await client.GetAsync($"/microclimates/{bilingual!.Id}?lang=es"))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal(["Triste", "Bien"], spanish!.Questions.Single().EmojiOptions!.Select(o => o.Label));

        var english = await (await client.GetAsync($"/microclimates/{bilingual.Id}?lang=en"))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();
        Assert.Equal(["Sad", "Good"], english!.Questions.Single().EmojiOptions!.Select(o => o.Label));
    }

    [Fact]
    public async Task Publishing_is_blocked_while_a_face_is_named_in_only_one_language()
    {
        var client = await AdminClientAsync();

        // Authored in both, but the second face has no Spanish name. The glyph is there,
        // so the scale LOOKS complete -- which is exactly why the gate has to catch it:
        // a Spanish respondent on a screen reader would get an English word or nothing.
        var created = await (await PostMicroclimateAsync(client, Both("Half-named", "A medio nombrar"),
        [
            new CreateQuestionInput(Both("How was your week?", "¿Cómo estuvo tu semana?"), "emoji_rating", null, true, 1,
            [
                new("\U0001F622", null, Both("Sad", "Triste")),
                new("\U0001F642", null, LocalizedInput.FromLocales(new Dictionary<string, string?> { ["en"] = "Good" })),
            ]),
        ], language: "both")).Content.ReadFromJsonAsync<MicroclimateDetail>();

        var activate = await client.PostAsync($"/microclimates/{created!.Id}/activate", null);

        Assert.Equal(HttpStatusCode.BadRequest, activate.StatusCode);
        var body = await activate.Content.ReadAsStringAsync();
        Assert.Contains("emojiOptions[1].label", body, StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // Criterion: answer validation rejects values outside the configured set
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_answer_outside_the_configured_emoji_values_is_rejected_and_one_inside_is_accepted()
    {
        var client = await AdminClientAsync();
        var created = await (await PostMicroclimateAsync(client, "Answerable",
                [new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1, FourFaces())]))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        var questionId = created.Questions.Single().Id;

        var anonymous = _factory.CreateClient();

        // 5 is off the end of a four-point scale. There is deliberately NO 1-5 fallback for
        // this type, unlike likert/rating -- an emoji scale has no meaning apart from the
        // faces its author configured.
        var tooHigh = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "5" }));
        Assert.Equal(HttpStatusCode.BadRequest, tooHigh.StatusCode);

        // The GLYPH is not an answer either: the stable value is what a client must submit,
        // for the same reason a multiple_choice label is not accepted (#195).
        var glyph = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "\U0001F642" }));
        Assert.Equal(HttpStatusCode.BadRequest, glyph.StatusCode);

        // Nor is the label.
        var label = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "Good" }));
        Assert.Equal(HttpStatusCode.BadRequest, label.StatusCode);

        var valid = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "3" }));
        Assert.Equal(HttpStatusCode.Created, valid.StatusCode);
    }

    [Fact]
    public async Task A_value_inside_1_to_5_but_outside_a_signed_scale_is_still_rejected()
    {
        var client = await AdminClientAsync();
        var created = await (await PostMicroclimateAsync(client, "Signed",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new("\U0001F622", -1, "Bad"),
                new("\U0001F610", 0, "Neutral"),
                new("\U0001F642", 1, "Good"),
            ]),
        ])).Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));
        var questionId = created.Questions.Single().Id;

        var anonymous = _factory.CreateClient();

        // "3" is a perfectly good answer to a 1-5 numeric scale and is NOT on this one. This
        // is the case a shared "is it 1..5" check would wave through.
        var offScale = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "3" }));
        Assert.Equal(HttpStatusCode.BadRequest, offScale.StatusCode);

        var onScale = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [questionId] = "-1" }));
        Assert.Equal(HttpStatusCode.Created, onScale.StatusCode);
    }

    [Fact]
    public async Task An_emoji_rating_question_with_no_scale_at_all_accepts_nothing()
    {
        var client = await AdminClientAsync();

        // CreateAsync refuses to build one of these, so the row is made directly -- the point
        // is that SubmitResponseAsync stays defensive against a question that reached the
        // database another way (a template instantiation, or a row predating this check).
        var created = await (await PostMicroclimateAsync(client, "Scale-less",
                [new CreateQuestionInput("Anything to add?", "open_ended", null, true, 1)]))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();
        await client.PutAsJsonAsync($"/microclimates/{created!.Id}", new UpdateMicroclimateRequest(null, null, "active", null));

        Guid scalelessId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var question = new MicroclimateQuestion
            {
                Id = Guid.NewGuid(),
                MicroclimateId = created.Id,
                TextEn = "How was your week?",
                Type = "emoji_rating",
                Required = true,
                Order = 2,
            };
            db.MicroclimateQuestions.Add(question);
            await db.SaveChangesAsync();
            scalelessId = question.Id;
        }

        var anonymous = _factory.CreateClient();
        var response = await anonymous.PostAsJsonAsync($"/microclimates/{created.Id}/responses",
            new SubmitResponseRequest(new Dictionary<Guid, string> { [scalelessId] = "1" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("no configured emoji options", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // Criterion: ForMicroclimate includes emoji_rating -- and the write path
    // refuses the shapes that would make it unanswerable
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_scale_with_fewer_than_two_faces_is_refused()
    {
        var client = await AdminClientAsync();

        var single = await PostMicroclimateAsync(client, "One face",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
                [new("\U0001F642", null, "Good")]),
        ]);
        Assert.Equal(HttpStatusCode.BadRequest, single.StatusCode);

        var none = await PostMicroclimateAsync(client, "No faces",
            [new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1, null)]);
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);
    }

    [Fact]
    public async Task Two_faces_sharing_a_value_are_refused()
    {
        var client = await AdminClientAsync();

        var response = await PostMicroclimateAsync(client, "Ambiguous",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new("\U0001F622", 1, "Sad"),
                new("\U0001F642", 1, "Good"),
            ]),
        ]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_emoji_scale_on_a_type_that_cannot_render_one_is_refused_rather_than_dropped()
    {
        var client = await AdminClientAsync();

        // The failure this prevents is silent: a 201 whose response body simply does not
        // contain the scale the author wrote.
        var response = await PostMicroclimateAsync(client, "Wrong type",
            [new CreateQuestionInput("Anything to add?", "open_ended", null, true, 1, FourFaces())]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_emoji_rating_question_carrying_plain_options_is_refused()
    {
        var client = await AdminClientAsync();

        var response = await PostMicroclimateAsync(client, "Two option sets",
        [
            new CreateQuestionInput(
                "How was your week?",
                "emoji_rating",
                [new CreateQuestionOptionInput(null, "Yes"), new CreateQuestionOptionInput(null, "No")],
                true,
                1,
                FourFaces()),
        ]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Deleting_a_question_takes_its_scale_with_it()
    {
        var client = await AdminClientAsync();
        var created = await (await PostMicroclimateAsync(client, "Cascade",
                [new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1, FourFaces())]))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();
        var questionId = created!.Questions.Single().Id;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        Assert.Equal(4, await db.MicroclimateQuestionEmojiOptions.CountAsync(o => o.MicroclimateQuestionId == questionId));

        db.MicroclimateQuestions.Remove(await db.MicroclimateQuestions.FirstAsync(q => q.Id == questionId));
        await db.SaveChangesAsync();

        // Orphaned emoji rows would be rows nothing can reach and nothing will clean up.
        Assert.Equal(0, await db.MicroclimateQuestionEmojiOptions.CountAsync(o => o.MicroclimateQuestionId == questionId));
    }

    // ------------------------------------------------------------------
    // The column budgets. Both of these are the same defect twice: a value the
    // column cannot hold reaching it as a DbUpdateException, which Program.cs turns
    // into "An unexpected error occurred." -- a 500 an author cannot act on, for
    // input they typed.
    // ------------------------------------------------------------------

    [Fact]
    public async Task An_over_long_glyph_is_refused_by_the_endpoint_rather_than_by_the_column()
    {
        var client = await AdminClientAsync();

        // 17 code points: one past what varchar(16) holds.
        var tooLong = string.Concat(Enumerable.Repeat("\U0001F642", 17));
        var refused = await PostMicroclimateAsync(client, "Long glyph",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new(tooLong, null, "Sad"),
                new("\U0001F642", null, "Good"),
            ]),
        ]);

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Contains("longer than 16 characters", await refused.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // And exactly 16 is accepted -- which also pins the UNIT. Sixteen of these is 32
        // UTF-16 units, so a string.Length check would refuse a glyph the column holds
        // and report a limit Postgres does not apply.
        var accepted = await PostMicroclimateAsync(client, "Exactly sixteen",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new(string.Concat(Enumerable.Repeat("\U0001F642", 16)), null, "Sad"),
                new("\U0001F622", null, "Good"),
            ]),
        ]);
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
    }

    [Fact]
    public async Task An_over_long_name_is_refused_by_the_endpoint_rather_than_becoming_a_500()
    {
        var client = await AdminClientAsync();

        // 101 characters. Not an exotic input: this is the field an author writes a
        // phrase into, and it is the one field the whole feature exists for.
        var response = await PostMicroclimateAsync(client, "Long name",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new("\U0001F622", null, new string('a', 101)),
                new("\U0001F642", null, "Good"),
            ]),
        ]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("longer than 100 characters", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_glyph_that_is_only_whitespace_is_refused_and_a_padded_one_is_stored_without_its_padding()
    {
        var client = await AdminClientAsync();

        // Without the trim, "   " passes the IsNullOrEmpty check and a scale point whose
        // glyph is three spaces is stored -- a face a respondent sees as a blank.
        var blank = await PostMicroclimateAsync(client, "Blank glyph",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new("   ", null, "Sad"),
                new("\U0001F642", null, "Good"),
            ]),
        ]);
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);
        Assert.Contains("needs an emoji", await blank.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var created = await (await PostMicroclimateAsync(client, "Padded glyph",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new("  \U0001F622  ", null, "Sad"),
                new("\U0001F642", null, "Good"),
            ]),
        ])).Content.ReadFromJsonAsync<MicroclimateDetail>();

        var read = await client.GetFromJsonAsync<MicroclimateDetail>($"/microclimates/{created!.Id}");
        Assert.Equal("\U0001F622", read!.Questions[0].EmojiOptions![0].Emoji);
    }

    [Fact]
    public async Task A_padded_name_is_stored_without_its_padding()
    {
        var client = await AdminClientAsync();

        // The name is the accessible name, and a screen reader reading "  Sad  " is the
        // small kind of wrong that never gets reported.
        var created = await (await PostMicroclimateAsync(client, Both("Padded names", "Nombres con espacios"),
        [
            new CreateQuestionInput(Both("How was your week?", "¿Cómo estuvo tu semana?"), "emoji_rating", null, true, 1,
            [
                new("\U0001F622", null, Both("  Sad  ", "  Triste  ")),
                new("\U0001F642", null, Both("Good", "Bien")),
            ]),
        ], language: "both")).Content.ReadFromJsonAsync<MicroclimateDetail>();

        var english = await client.GetFromJsonAsync<MicroclimateDetail>($"/microclimates/{created!.Id}?lang=en");
        Assert.Equal("Sad", english!.Questions[0].EmojiOptions![0].Label);

        var spanish = await client.GetFromJsonAsync<MicroclimateDetail>($"/microclimates/{created.Id}?lang=es");
        Assert.Equal("Triste", spanish!.Questions[0].EmojiOptions![0].Label);
    }

    // ------------------------------------------------------------------
    // Criterion: rendered with an accessible name -- the read side of it
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_name_served_in_a_language_it_was_not_authored_in_says_so()
    {
        var client = await AdminClientAsync();

        // Spanish-only content, read with ?lang=en. The names come back in Spanish
        // because that is all there is, and every one of them self-reports.
        var created = await (await PostMicroclimateAsync(client, "Pulso",
        [
            new CreateQuestionInput("¿Cómo estuvo tu semana?", "emoji_rating", null, true, 1,
            [
                new("\U0001F622", null, "Triste"),
                new("\U0001F642", null, "Bien"),
            ]),
        ], language: "es")).Content.ReadFromJsonAsync<MicroclimateDetail>();

        var read = await client.GetFromJsonAsync<MicroclimateDetail>($"/microclimates/{created!.Id}?lang=en");

        // MicroclimateContentNotice renders this count to the reader. A silent
        // substitution here is an English-speaking respondent handed a Spanish word with
        // nothing saying so -- and on this control the name is the only thing a screen
        // reader has to go on.
        Assert.Contains("questions[1].emojiOptions[0].label", read!.FallbackFields);
        Assert.Contains("questions[1].emojiOptions[1].label", read.FallbackFields);
        Assert.Equal("Triste", read.Questions[0].EmojiOptions![0].Label);
    }

    [Fact]
    public async Task A_face_with_no_name_in_any_language_blocks_publishing()
    {
        var client = await AdminClientAsync();

        // CreateAsync refuses a nameless face, so this row is inserted directly. That is
        // the whole point: the publish gate marks an emoji name REQUIRED rather than
        // optional, and Required only ever discriminates for a row that arrived some
        // other way -- a seed, a SQL statement, a future authoring endpoint. Every face
        // the API itself creates has at least one side filled, so a gate that treated
        // these as optional would look identical on every test that goes through it.
        var created = await (await PostMicroclimateAsync(client, "Nameless face",
        [
            new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1,
            [
                new("\U0001F622", null, "Sad"),
                new("\U0001F642", null, "Good"),
            ]),
        ])).Content.ReadFromJsonAsync<MicroclimateDetail>();
        var questionId = created!.Questions.Single().Id;

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.MicroclimateQuestionEmojiOptions.Add(new MicroclimateQuestionEmojiOption
            {
                MicroclimateQuestionId = questionId,
                Order = 2,
                Emoji = "\U0001F929",
                Value = 3,
                LabelEn = null,
                LabelEs = null,
            });
            await db.SaveChangesAsync();
        }

        var activate = await client.PostAsync($"/microclimates/{created.Id}/activate", null);

        Assert.Equal(HttpStatusCode.BadRequest, activate.StatusCode);
        Assert.Contains("questions[1].emojiOptions[2].label", await activate.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    // ------------------------------------------------------------------
    // The storage's own guarantees: the index, and the loader's scope
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_database_itself_refuses_two_faces_of_one_question_sharing_a_value()
    {
        var client = await AdminClientAsync();
        var created = await (await PostMicroclimateAsync(client, "Ambiguous by insert",
                [new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1, FourFaces())]))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();
        var questionId = created!.Questions.Single().Id;

        // The endpoint's own duplicate check is what an author meets, and it masks this:
        // no request can reach the index. So the index is asserted directly, because it
        // is the thing that has to hold for a row written any other way -- and because a
        // migration that dropped `unique: true` would leave the EF model and its snapshot
        // still agreeing with each other, so MigrateAsync's PendingModelChangesWarning
        // cannot see it either.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        db.MicroclimateQuestionEmojiOptions.Add(new MicroclimateQuestionEmojiOption
        {
            MicroclimateQuestionId = questionId,
            Order = 9,
            Emoji = "\U0001F642",
            Value = 1, // already taken by face 0
            LabelEn = "Also good",
        });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task The_scale_loader_reads_only_the_questions_it_was_asked_for()
    {
        var client = await AdminClientAsync();

        var first = await (await PostMicroclimateAsync(client, "First",
                [new CreateQuestionInput("How was your week?", "emoji_rating", null, true, 1, FourFaces())]))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();
        var second = await (await PostMicroclimateAsync(client, "Second",
                [new CreateQuestionInput("And the week before?", "emoji_rating", null, true, 1, FourFaces())]))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        var wanted = first!.Questions.Single().Id;
        var unwanted = second!.Questions.Single().Id;

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
        var loaded = await MicroclimateContent.LoadEmojiOptionsAsync(db, [wanted], CancellationToken.None);

        // Asserted on the loader rather than through a response, because a response
        // cannot see this: the rows are grouped by question id, so every other tenant's
        // scale being dragged into memory on every microclimate read, gate check and
        // response submission produces byte-identical output.
        var only = Assert.Single(loaded);
        Assert.Equal(wanted, only.Key);
        Assert.Equal(4, only.Value.Count);
        Assert.DoesNotContain(unwanted, loaded.Keys);
    }

    // ------------------------------------------------------------------
    // The OTHER endpoint that creates microclimate questions
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_template_typed_emoji_rating_is_refused_rather_than_instantiated_without_a_scale()
    {
        var client = await AdminClientAsync();

        // microclimate_template_questions has no emoji child table, and Instantiate
        // copies Type verbatim -- so before this guard existed, /use answered 201 with a
        // live emoji_rating question carrying no scale at all.
        Guid templateId;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var now = DateTimeOffset.UtcNow;
            var template = new MicroclimateTemplate
            {
                Id = Guid.NewGuid(),
                Name = "Faces template",
                Description = "A weekly pulse",
                Category = "pulse",
                CompanyId = _companyId,
                IsSystemTemplate = false,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now,
            };
            db.MicroclimateTemplates.Add(template);
            db.MicroclimateTemplateQuestions.Add(new MicroclimateTemplateQuestion
            {
                Id = Guid.NewGuid(),
                TemplateId = template.Id,
                TextEn = "How was your week?",
                Type = "emoji_rating",
                Required = true,
                Order = 1,
            });
            await db.SaveChangesAsync();
            templateId = template.Id;
        }

        var response = await client.PostAsJsonAsync(
            $"/microclimate-templates/{templateId}/use",
            new UseMicroclimateTemplateRequest());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("nowhere to store its emoji scale", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // And nothing was created on the way to refusing.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            Assert.Equal(0, await db.Microclimates.CountAsync(m => m.TemplateId == templateId));
        }
    }

    [Fact]
    public async Task A_microclimate_holding_a_scale_less_emoji_question_cannot_be_activated()
    {
        var client = await AdminClientAsync();

        // The last guard before the respondent link goes out, and the only one that
        // covers a question written by something other than CreateAsync. Without it the
        // reader is served a question every answer to which is a 400.
        var created = await (await PostMicroclimateAsync(client, "Half-built",
                [new CreateQuestionInput("Anything to add?", "open_ended", null, true, 1)]))
            .Content.ReadFromJsonAsync<MicroclimateDetail>();

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            db.MicroclimateQuestions.Add(new MicroclimateQuestion
            {
                Id = Guid.NewGuid(),
                MicroclimateId = created!.Id,
                TextEn = "How was your week?",
                Type = "emoji_rating",
                Required = true,
                Order = 2,
            });

            // ...and one with a SINGLE face, which is the case the threshold decides. It
            // is named, so the translation half of the gate has nothing to say about it:
            // the only thing wrong with this question is that a scale of one has nothing
            // to choose between, which is the same argument the minimum-two check makes
            // at creation.
            var oneFace = new MicroclimateQuestion
            {
                Id = Guid.NewGuid(),
                MicroclimateId = created.Id,
                TextEn = "And the week before?",
                Type = "emoji_rating",
                Required = true,
                Order = 3,
            };
            db.MicroclimateQuestions.Add(oneFace);
            db.MicroclimateQuestionEmojiOptions.Add(new MicroclimateQuestionEmojiOption
            {
                MicroclimateQuestionId = oneFace.Id,
                Order = 0,
                Emoji = "\U0001F642",
                Value = 1,
                LabelEn = "Good",
            });
            await db.SaveChangesAsync();
        }

        var activate = await client.PostAsync($"/microclimates/{created!.Id}/activate", null);

        Assert.Equal(HttpStatusCode.BadRequest, activate.StatusCode);
        var body = await activate.Content.ReadAsStringAsync();
        Assert.Contains("questions[2]", body, StringComparison.Ordinal);
        Assert.Contains("questions[3]", body, StringComparison.Ordinal);
        Assert.Contains("fewer than 2 emoji options", body, StringComparison.Ordinal);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ClimateProjectDbContext>();
            var still = await db.Microclimates.FirstAsync(m => m.Id == created.Id);
            Assert.Equal(MicroclimateStatuses.Draft, still.Status);
        }
    }
}
