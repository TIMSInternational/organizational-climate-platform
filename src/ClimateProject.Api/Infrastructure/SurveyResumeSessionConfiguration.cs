using ClimateProject.Application.Surveys;

namespace ClimateProject.Api.Infrastructure;

/// <summary>
/// Reads the resume key out of configuration. Separate from <see cref="SurveyResumeSession"/>
/// because <c>ClimateProject.Application</c> does not reference the configuration abstractions
/// and should not start to for one lookup -- the key NAMES live beside the derivation, and only
/// the reading of them is here.
/// </summary>
public static class SurveyResumeSessionConfiguration
{
    /// <summary>
    /// <see cref="SurveyResumeSession.KeyName"/>, falling back to
    /// <see cref="SurveyResumeSession.FallbackKeyName"/>.
    /// </summary>
    public static string? KeyFrom(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        return configuration[SurveyResumeSession.KeyName] ?? configuration[SurveyResumeSession.FallbackKeyName];
    }
}
