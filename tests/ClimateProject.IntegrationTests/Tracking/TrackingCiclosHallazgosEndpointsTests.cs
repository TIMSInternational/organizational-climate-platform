using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.Surveys;
using ClimateProject.Application.Tracking;
using ClimateProject.Domain.Entities;
using ClimateProject.IntegrationTests.Support;
using ClimateProject.IntegrationTests.Surveys;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.IntegrationTests.Tracking;

/// <summary>
/// #385: <c>/api/internal/ciclos-encuesta</c> and <c>/api/internal/hallazgos</c>, which were
/// unconditional empty stubs until the surveys domain existed.
///
/// **Why these live here and not only in <c>TrackingHallazgosTests</c>.** The projection is
/// pure and is proved there without Docker. What only a real request can prove is the half
/// that the stub got wrong: that the two query filters are actually applied, that a
/// misconfigured <c>company_id</c> is answered with a status code that says so, and that a
/// tenant boundary holds across a real query rather than across a dictionary a test built.
///
/// Every assertion below reads the response BODY as well as the status. A route that
/// answers 200 with an empty list is exactly what shipped before, and "not a 500" would
/// have passed against it.
/// </summary>
[Collection("Postgres")]
public class TrackingCiclosHallazgosEndpointsTests : IAsyncLifetime
{
    private readonly AuthWebApplicationFactory _factory;
    private readonly SurveyTestHarness _harness;
    private readonly JsonSerializerOptions _snakeCase = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };

    private const string Comunicacion = "comunicacion";
    private const string Reconocimiento = "reconocimiento";

    private Guid _companyA;
    private Guid _companyB;
    private Guid _engineering;
    private Guid _sales;

    /// <summary>The closed survey the assertions are about.</summary>
    private Guid _closedSurvey;

    /// <summary>A second closed survey, so <c>ciclo_id</c> has something to exclude.</summary>
    private Guid _otherClosedSurvey;

    /// <summary>Still collecting. Its scores move, so it must publish no findings.</summary>
    private Guid _activeSurvey;

    /// <summary>Company B's own closed survey, with its own responses.</summary>
    private Guid _companyBSurvey;

    private Guid _companyBDepartment;

    public TrackingCiclosHallazgosEndpointsTests(PostgresContainerFixture postgres)
    {
        _factory = postgres.App;
        _harness = new SurveyTestHarness(_factory, $"hal-{Guid.NewGuid():N}.test");
    }

    public async Task InitializeAsync()
    {
        _companyA = await _harness.SeedCompanyAsync("Hallazgos Co A");
        _companyB = await _harness.SeedCompanyAsync("Hallazgos Co B");
        _engineering = await _harness.SeedDepartmentAsync(_companyA, "Engineering");
        _sales = await _harness.SeedDepartmentAsync(_companyA, "Sales");
        _companyBDepartment = await _harness.SeedDepartmentAsync(_companyB, "Rival Engineering");

        var adminA = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);

        // Engineering clears SurveyResultsPrivacy.MinimumSegmentRespondents (5) with six.
        // Sales sits one below it with four -- that gap is the floor ruling's whole subject.
        _closedSurvey = await SeedClosedSurveyAsync(adminA, _companyA, new Dictionary<Guid, (int Count, int Answer)>
        {
            [_engineering] = (6, 4),
            [_sales] = (4, 2),
        });

        _otherClosedSurvey = await SeedClosedSurveyAsync(adminA, _companyA, new Dictionary<Guid, (int, int)>
        {
            [_engineering] = (6, 2),
        });

        _activeSurvey = await SeedSurveyAsync(adminA, _companyA, new Dictionary<Guid, (int, int)>
        {
            [_engineering] = (6, 5),
        });
        await SurveyTestHarness.SetStatusAsync(adminA, _activeSurvey, SurveyStatuses.Active);

        var adminB = await _harness.ClientAsync(Roles.CompanyAdmin, _companyB);
        _companyBSurvey = await SeedClosedSurveyAsync(adminB, _companyB, new Dictionary<Guid, (int, int)>
        {
            [_companyBDepartment] = (6, 5),
        });

        // Explicit, ordered windows. /hallazgos scans the most recent
        // TrackingInternalEndpoints.MaxSurveysAggregated closed surveys, and the fixture is
        // only able to say anything about the tenant predicate if company B's history is
        // NEWER than company A's -- see Another_companys_survey_never_appears... for why.
        await SetWindowAsync(_closedSurvey, DateTimeOffset.UtcNow.AddDays(-60), DateTimeOffset.UtcNow.AddDays(-30));
        await SetWindowAsync(_otherClosedSurvey, DateTimeOffset.UtcNow.AddDays(-61), DateTimeOffset.UtcNow.AddDays(-31));
        await SetWindowAsync(_companyBSurvey, DateTimeOffset.UtcNow.AddDays(-2), DateTimeOffset.UtcNow.AddDays(1));

        // Company B's back catalogue, enough of it to fill the scan window on its own. These
        // carry no questions and so no findings; what they are for is occupying slots.
        var createdBy = await _harness.WithDbAsync(db =>
            db.Surveys.Where(s => s.Id == _companyBSurvey).Select(s => s.CreatedBy).FirstAsync());

        for (var i = 0; i < FillerSurveys; i++)
        {
            await SeedBareClosedSurveyAsync(_companyB, createdBy, DateTimeOffset.UtcNow.AddMinutes(-i));
        }
    }

    /// <summary>
    /// One fewer than <c>TrackingInternalEndpoints.MaxSurveysAggregated</c>, so that company
    /// B's real survey plus these exactly fill the window.
    /// </summary>
    private const int FillerSurveys = 11;

    private Task SetWindowAsync(Guid surveyId, DateTimeOffset start, DateTimeOffset end)
        => _harness.WithDbAsync(async db =>
        {
            var survey = await db.Surveys.FirstAsync(s => s.Id == surveyId);
            survey.StartDate = start;
            survey.EndDate = end;
            await db.SaveChangesAsync();
        });

    private Task SeedBareClosedSurveyAsync(Guid companyId, Guid createdBy, DateTimeOffset endDate)
        => _harness.WithDbAsync(async db =>
        {
            db.Surveys.Add(new Survey
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                CreatedBy = createdBy,
                TitleEn = "Filler",
                Language = "en",
                Type = "general_climate",
                StartDate = endDate.AddDays(-7),
                EndDate = endDate,
                Status = SurveyStatuses.Closed,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        });

    public Task DisposeAsync() => Task.CompletedTask;

    // ------------------------------------------------------------------
    // Seeding
    // ------------------------------------------------------------------

    /// <summary>
    /// A two-dimension Likert survey plus its responses. The questions go in through the
    /// real <c>POST /surveys</c> so their <c>Category</c> and scale bounds are stored the way
    /// the authoring surface stores them; the responses go in directly because there is no
    /// respond endpoint that can write a department onto an answer here.
    /// </summary>
    private async Task<Guid> SeedSurveyAsync(
        HttpClient admin,
        Guid companyId,
        IReadOnlyDictionary<Guid, (int Count, int Answer)> perDepartment)
    {
        var survey = await SurveyTestHarness.CreateSurveyAsync(admin, SurveyTestHarness.MinimalRequest(
            companyId,
            questions:
            [
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Communication is clear"),
                    "likert",
                    Order: 0,
                    Category: Comunicacion),
                new CreateSurveyQuestionInput(
                    LocalizedInput.FromBare("Good work is recognised"),
                    "likert",
                    Order: 1,
                    Category: Reconocimiento),
            ]));

        var questionIds = survey.Questions.OrderBy(q => q.Order).Select(q => q.Id).ToList();

        await _harness.WithDbAsync(async db =>
        {
            foreach (var (departmentId, (count, answer)) in perDepartment)
            {
                for (var i = 0; i < count; i++)
                {
                    var responseId = Guid.NewGuid();
                    db.Responses.Add(new Response
                    {
                        Id = responseId,
                        SurveyId = survey.Id,
                        CompanyId = companyId,
                        DepartmentId = departmentId,
                        SessionId = Guid.NewGuid().ToString("N"),
                        Language = "en",
                        IsComplete = true,
                        IsAnonymous = true,
                        StartTime = DateTimeOffset.UtcNow.AddMinutes(-5),
                        CompletionTime = DateTimeOffset.UtcNow,
                        TotalTimeSeconds = 300,
                        CreatedAt = DateTimeOffset.UtcNow,
                        UpdatedAt = DateTimeOffset.UtcNow,
                    });

                    foreach (var questionId in questionIds)
                    {
                        db.QuestionResponses.Add(new QuestionResponse
                        {
                            ResponseId = responseId,
                            QuestionId = questionId,
                            // jsonb: a bare 4 is not valid JSON and Postgres rejects it 22P02.
                            ResponseValue = JsonSerializer.Serialize(answer.ToString()),
                            ResponseText = null,
                        });
                    }
                }
            }

            await db.SaveChangesAsync();
        });

        return survey.Id;
    }

    private async Task<Guid> SeedClosedSurveyAsync(
        HttpClient admin,
        Guid companyId,
        IReadOnlyDictionary<Guid, (int Count, int Answer)> perDepartment)
    {
        var surveyId = await SeedSurveyAsync(admin, companyId, perDepartment);
        await SurveyTestHarness.SetStatusAsync(admin, surveyId, SurveyStatuses.Active);
        await SurveyTestHarness.SetStatusAsync(admin, surveyId, SurveyStatuses.Closed);
        return surveyId;
    }

    private HttpClient InternalClient()
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", AuthWebApplicationFactory.TestInternalApiKey);
        return client;
    }

    private async Task<IReadOnlyList<HallazgoInternalDto>> HallazgosAsync(string query)
    {
        var response = await InternalClient().GetAsync($"/api/internal/hallazgos?{query}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<HallazgosData>>(_snakeCase);
        Assert.True(envelope!.Success);
        return envelope.Data.Hallazgos;
    }

    private async Task<IReadOnlyList<CicloInternalDto>> CiclosAsync(string companyId)
    {
        var response = await InternalClient().GetAsync($"/api/internal/ciclos-encuesta?company_id={companyId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var envelope = await response.Content.ReadFromJsonAsync<Envelope<CiclosData>>(_snakeCase);
        Assert.True(envelope!.Success);
        return envelope.Data.Ciclos;
    }

    // ==================================================================
    // The defect #385 is about: the route returns findings at all.
    // ==================================================================

    /// <summary>
    /// The stub returned <c>{"success":true,"data":{"hallazgos":[]}}</c> for every request
    /// ever made to it, which is why the tracking sheet's "Hallazgo (tema de la encuesta)"
    /// column fell back to raw ids in production. This asserts the categoria arrives in
    /// words -- the actual client-visible fix.
    /// </summary>
    [Fact]
    public async Task Hallazgos_carry_the_survey_dimension_as_words_not_an_opaque_id()
    {
        var hallazgos = await HallazgosAsync($"company_id={_companyA}&ciclo_id={_closedSurvey}");

        Assert.NotEmpty(hallazgos);
        Assert.All(hallazgos, h => Assert.False(string.IsNullOrWhiteSpace(h.Categoria)));
        Assert.Contains(Comunicacion, hallazgos.Select(h => h.Categoria));
        Assert.Contains(Reconocimiento, hallazgos.Select(h => h.Categoria));
        Assert.All(hallazgos, h => Assert.StartsWith("hal-", h.HallazgoId, StringComparison.Ordinal));
        Assert.All(hallazgos, h => Assert.Equal(_closedSurvey.ToString(), h.CicloId));
    }

    // ==================================================================
    // ATTACK: the floor ruling.
    // ==================================================================

    /// <summary>
    /// Sales answered with four people, one below the segment floor. Its findings must be
    /// PRESENT (a small team still gets an action plan) and its numbers must be ABSENT.
    ///
    /// This attack passes if the ruling is inverted either way: drop the segment and the
    /// first assertion fails, publish its score and the last one does.
    /// </summary>
    [Fact]
    public async Task A_sub_floor_department_yields_findings_with_a_categoria_and_no_score()
    {
        var hallazgos = await HallazgosAsync($"company_id={_companyA}&ciclo_id={_closedSurvey}");

        var salesNodo = _sales.ToString();
        var sales = hallazgos.Where(h => h.NodoId == salesNodo).ToList();

        Assert.Equal(2, sales.Count);
        Assert.Equal(
            new[] { Comunicacion, Reconocimiento },
            sales.Select(h => h.Categoria).OrderBy(c => c, StringComparer.Ordinal).ToArray());
        Assert.All(sales, h => Assert.Null(h.ResultadoPct));
    }

    /// <summary>
    /// The control for the test above: Engineering cleared the floor, so its score IS
    /// published. Without this, "never publish a score" would satisfy the ruling's letter
    /// and delete the feature.
    /// </summary>
    [Fact]
    public async Task A_department_above_the_floor_publishes_a_score()
    {
        var hallazgos = await HallazgosAsync($"company_id={_companyA}&ciclo_id={_closedSurvey}");

        var engineering = hallazgos.Where(h => h.NodoId == _engineering.ToString()).ToList();

        Assert.Equal(2, engineering.Count);
        // Six respondents answered 4 on the default 1-5 Likert: (4 - 1) / (5 - 1).
        Assert.All(engineering, h => Assert.Equal(0.75m, h.ResultadoPct));
    }

    // ==================================================================
    // ATTACK: the filters. The legacy route accepted ciclo_id and ignored it.
    // ==================================================================

    /// <summary>
    /// Two closed surveys exist for company A. Asking for one must not return the other's
    /// findings. An implementation that ignored <c>ciclo_id</c> -- the exact defect the
    /// stub's own comment warned against -- returns both and fails here.
    /// </summary>
    [Fact]
    public async Task Ciclo_id_actually_filters_and_does_not_leak_the_other_cycle()
    {
        var one = await HallazgosAsync($"company_id={_companyA}&ciclo_id={_closedSurvey}");
        var other = await HallazgosAsync($"company_id={_companyA}&ciclo_id={_otherClosedSurvey}");

        Assert.NotEmpty(one);
        Assert.NotEmpty(other);
        Assert.All(one, h => Assert.Equal(_closedSurvey.ToString(), h.CicloId));
        Assert.All(other, h => Assert.Equal(_otherClosedSurvey.ToString(), h.CicloId));
        Assert.Empty(one.Select(h => h.HallazgoId).Intersect(other.Select(h => h.HallazgoId), StringComparer.Ordinal));
    }

    /// <summary>
    /// <c>hallazgo_id</c> is how <c>GetHallazgoByIdAsync</c> resolves the finding a plan de
    /// accion was written against, and it is passed WITHOUT a ciclo_id. Exactly one row
    /// comes back, out of a feed that has several.
    /// </summary>
    [Fact]
    public async Task Hallazgo_id_actually_filters_to_one_finding_without_a_ciclo_id()
    {
        var all = await HallazgosAsync($"company_id={_companyA}");
        Assert.True(all.Count > 1, "the fixture must produce more than one finding for this to prove anything");

        var target = all.First(h => h.NodoId == _engineering.ToString() && h.Categoria == Reconocimiento);

        var filtered = await HallazgosAsync($"company_id={_companyA}&hallazgo_id={target.HallazgoId}");

        var single = Assert.Single(filtered);
        Assert.Equal(target.HallazgoId, single.HallazgoId);
        Assert.Equal(Reconocimiento, single.Categoria);
        Assert.Equal(target.ResultadoPct, single.ResultadoPct);
    }

    /// <summary>
    /// A <c>hallazgo_id</c> nobody issued is an empty list at 200, not a 404 and not the
    /// whole feed. The whole feed is the failure that matters: it is what the legacy route
    /// returned, and <c>GetHallazgoByIdAsync</c> would then have attached the first row's
    /// categoria to the plan.
    /// </summary>
    [Fact]
    public async Task An_unknown_hallazgo_id_returns_an_empty_list_rather_than_everything()
    {
        Assert.Empty(await HallazgosAsync($"company_id={_companyA}&hallazgo_id=hal-0000000000000000000000000000dead"));
    }

    /// <summary>
    /// Both filters together are an AND. Asking for a real hallazgo under the wrong ciclo
    /// returns nothing -- an implementation applying only whichever filter it saw last would
    /// return the row.
    /// </summary>
    [Fact]
    public async Task The_two_filters_are_an_AND_not_a_last_one_wins()
    {
        var target = (await HallazgosAsync($"company_id={_companyA}&ciclo_id={_closedSurvey}")).First();

        Assert.Empty(await HallazgosAsync(
            $"company_id={_companyA}&ciclo_id={_otherClosedSurvey}&hallazgo_id={target.HallazgoId}"));
    }

    /// <summary>
    /// An unknown or malformed <c>ciclo_id</c> is a true empty answer, not a caller error:
    /// it references a row that may legitimately not exist. Contrast the company_id test
    /// below -- the two are different kinds of parameter and get different verdicts.
    /// </summary>
    [Fact]
    public async Task An_unknown_ciclo_id_is_an_empty_200_rather_than_a_400()
    {
        Assert.Empty(await HallazgosAsync($"company_id={_companyA}&ciclo_id=not-a-survey-id"));
        Assert.Empty(await HallazgosAsync($"company_id={_companyA}&ciclo_id={Guid.NewGuid()}"));
    }

    // ==================================================================
    // ATTACK: the status code is the message.
    // ==================================================================

    /// <summary>
    /// A non-GUID <c>company_id</c> is a 400 with a message that names the parameter --
    /// never a 403 (this repo has had three defects of that exact shape) and never an
    /// empty 200, which is what the stub answered and what would let a deployment with a
    /// blank <c>ProcomerCompanyId</c> ship an export of raw ids while looking healthy.
    /// </summary>
    [Fact]
    public async Task A_non_guid_company_id_is_a_400_that_names_the_parameter()
    {
        foreach (var route in new[] { "/api/internal/hallazgos", "/api/internal/ciclos-encuesta" })
        {
            var response = await InternalClient().GetAsync($"{route}?company_id=not-a-guid");

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Contains("company_id", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        }
    }

    /// <summary>An empty company_id is the blank-configuration case, and gets the same 400.</summary>
    [Fact]
    public async Task A_blank_company_id_is_a_400()
    {
        var response = await InternalClient().GetAsync("/api/internal/hallazgos?company_id=");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ==================================================================
    // ATTACK: the tenant boundary.
    // ==================================================================

    /// <summary>
    /// Company B has its own closed survey with six respondents, so it genuinely has
    /// findings to leak. None may appear under company A's company_id -- and naming B's own
    /// ciclo explicitly must not fetch it either, which is what a filter applied before the
    /// tenant predicate would get wrong.
    ///
    /// **The last assertion is the one that earns this test.** Deleting the
    /// <c>s.CompanyId == companyGuid</c> predicate leaks nothing on its own: the projection
    /// drops any segment whose department is not in the requesting company's nodo map, so
    /// the rows would be computed and then thrown away. That second guard was found by
    /// mutating the predicate away and watching this test still pass. What the predicate
    /// alone protects is the SCAN WINDOW: <c>MaxSurveysAggregated</c> bounds how many
    /// surveys a request aggregates, and company B's back catalogue is seeded newer than
    /// company A's and large enough to fill it -- so without the predicate, company A's own
    /// findings fall off the end of an unscoped ordering and A's feed comes back empty while
    /// still looking perfectly well-formed.
    /// </summary>
    [Fact]
    public async Task Another_companys_survey_never_appears_in_this_companys_feed()
    {
        var mine = await HallazgosAsync($"company_id={_companyA}");
        var theirs = await HallazgosAsync($"company_id={_companyB}");

        Assert.NotEmpty(theirs);
        Assert.DoesNotContain(_companyBSurvey.ToString(), mine.Select(h => h.CicloId));
        Assert.DoesNotContain(_companyBDepartment.ToString(), mine.Select(h => h.NodoId));

        Assert.Empty(await HallazgosAsync($"company_id={_companyA}&ciclo_id={_companyBSurvey}"));

        var ciclos = await CiclosAsync(_companyA.ToString());
        Assert.DoesNotContain(_companyBSurvey.ToString(), ciclos.Select(c => c.CicloId));

        // A's own findings are still here, behind a rival tenant whose newer surveys would
        // otherwise consume the whole scan window.
        Assert.Contains(_closedSurvey.ToString(), mine.Select(h => h.CicloId));
        Assert.Contains(_otherClosedSurvey.ToString(), mine.Select(h => h.CicloId));
    }

    // ==================================================================
    // ATTACK: identifier stability, across two real requests.
    // ==================================================================

    /// <summary>
    /// Two syncs, the same ids. <c>PlanDeAccion.HallazgoExternalId</c> is a cross-service
    /// reference with no foreign key behind it, so a shifting id orphans plans silently.
    /// This is the request-level companion of the unit test: it also proves the ids survive
    /// the whole load-and-aggregate path, not just one in-memory computation.
    /// </summary>
    [Fact]
    public async Task The_same_findings_come_back_with_the_same_ids_on_a_second_sync()
    {
        var first = await HallazgosAsync($"company_id={_companyA}&ciclo_id={_closedSurvey}");
        var second = await HallazgosAsync($"company_id={_companyA}&ciclo_id={_closedSurvey}");

        Assert.NotEmpty(first);
        Assert.Equal(
            first.Select(h => h.HallazgoId).ToList(),
            second.Select(h => h.HallazgoId).ToList());
        Assert.Equal(
            first.Select(h => h.HallazgoId).Distinct(StringComparer.Ordinal).Count(),
            first.Count);
    }

    /// <summary>
    /// The id has to fit <c>planes_de_accion.hallazgo_external_id</c>, declared
    /// <c>varchar(64)</c> by <c>PlanDeAccionConfiguration</c>. A value that overflows it is
    /// truncated on write, and a truncated foreign reference stops matching without
    /// reporting anything.
    /// </summary>
    [Fact]
    public async Task Every_emitted_id_fits_the_consumers_column()
    {
        var hallazgos = await HallazgosAsync($"company_id={_companyA}");

        Assert.NotEmpty(hallazgos);
        Assert.All(hallazgos, h => Assert.True(h.HallazgoId.Length <= 64, h.HallazgoId));
        Assert.All(hallazgos, h => Assert.True(h.NodoId.Length <= 64, h.NodoId));
    }

    // ==================================================================
    // ATTACK: only settled surveys produce findings.
    // ==================================================================

    /// <summary>
    /// The active survey has six Engineering respondents, so it would produce findings if
    /// status were not filtered. It must not: an open survey's scores move between two
    /// loads, and a plan de accion is written against one number on one day.
    ///
    /// It still appears in /ciclos-encuesta as <c>abierto</c> -- the tracking module caches
    /// open cycles, and its CacheSyncWorker has a state for exactly this.
    /// </summary>
    [Fact]
    public async Task An_open_survey_is_a_ciclo_but_has_no_findings_yet()
    {
        var hallazgos = await HallazgosAsync($"company_id={_companyA}&ciclo_id={_activeSurvey}");
        Assert.Empty(hallazgos);

        var ciclo = Assert.Single(
            await CiclosAsync(_companyA.ToString()),
            c => c.CicloId == _activeSurvey.ToString());
        Assert.Equal("abierto", ciclo.Estado);
    }

    // ==================================================================
    // /ciclos-encuesta
    // ==================================================================

    /// <summary>
    /// A ciclo is a survey: its window, its question count, its state and its tenant. The
    /// stub returned an empty list, so climate-tracking's <c>CicloEncuestaCache</c> was
    /// never populated and <c>PlanDeAccion.CicloEncuestaExternalId</c> was always null --
    /// which is the link in the chain that made the export skip its hallazgo lookup
    /// entirely.
    /// </summary>
    [Fact]
    public async Task Ciclos_publish_each_surveys_window_question_count_and_state()
    {
        var ciclos = await CiclosAsync(_companyA.ToString());

        var closed = Assert.Single(ciclos, c => c.CicloId == _closedSurvey.ToString());

        Assert.Equal("cerrado", closed.Estado);
        Assert.Equal(2, closed.NumeroPreguntas);
        Assert.Equal(_companyA.ToString(), closed.CompanyId);
        Assert.True(closed.FechaCierre > closed.FechaApertura);
    }

    /// <summary>
    /// A draft has never been shown to anyone and its content is still being edited.
    /// Publishing it would advertise an unfinished instrument as a cycle that exists.
    /// </summary>
    [Fact]
    public async Task A_draft_survey_is_not_a_ciclo()
    {
        var adminA = await _harness.ClientAsync(Roles.CompanyAdmin, _companyA);
        var draft = await SurveyTestHarness.CreateSurveyAsync(
            adminA, SurveyTestHarness.MinimalRequest(_companyA));

        var ciclos = await CiclosAsync(_companyA.ToString());

        Assert.DoesNotContain(draft.Id.ToString(), ciclos.Select(c => c.CicloId));
    }
}
