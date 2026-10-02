using ClimateProject.Application.OrgStructure.Intake;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// The intake's model, in every test host: one singleton on the shared host, so a test that
/// needs the AI intake sets <see cref="Answer"/> instead of building a host of its own (#279's
/// host budget). By default it is exactly what an unconfigured production host is — not
/// configured, answering <c>ai_unavailable</c> — so no other test notices it exists.
///
/// <para>Safe to share: every test in the "Postgres" collection runs one at a time, and each
/// intake test calls <see cref="Reset"/> first.</para>
/// </summary>
public sealed class TestIntakeMappingModel : IIntakeMappingModel
{
    public Func<IntakeProfile, IntakeTargets, IntakeMapping?>? Answer { get; set; }

    public List<(IntakeProfile Profile, IntakeTargets Targets, string Language)> Calls { get; } = [];

    public bool IsConfigured => Answer is not null;

    public void Reset(Func<IntakeProfile, IntakeTargets, IntakeMapping?>? answer)
    {
        Answer = answer;
        Calls.Clear();
    }

    public Task<IntakeModelResult> MapAsync(IntakeProfile profile, IntakeTargets targets, string language, CancellationToken cancellationToken)
    {
        if (Answer is null)
        {
            return Task.FromResult(IntakeModelResult.Failed("ai_unavailable"));
        }

        Calls.Add((profile, targets, language));
        var mapping = Answer(profile, targets);
        return Task.FromResult(mapping is null
            ? IntakeModelResult.Failed("ai_failed", "fake")
            : new IntakeModelResult(mapping, null, "fake-model", 1200, 300));
    }
}
