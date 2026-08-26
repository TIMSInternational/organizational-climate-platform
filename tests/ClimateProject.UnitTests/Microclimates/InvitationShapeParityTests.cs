using System.Reflection;
using ClimateProject.Application.Microclimates;
using ClimateProject.Application.Surveys;

namespace ClimateProject.UnitTests.Microclimates;

/// <summary>
/// "Shape reusable by #116" (#130), made falsifiable instead of asserted in prose.
///
/// <para>
/// The issue's last acceptance criterion asks that this surface be the reference shape for
/// the survey one. Two things follow from that and only one of them is obvious.
/// </para>
/// <para>
/// The obvious one: a web client that renders an invitation funnel should be able to render
/// both from one component. It cannot if <c>recorded</c> is called <c>wasRecorded</c> on one
/// of them.
/// </para>
/// <para>
/// The less obvious one, and the reason this file is a test rather than a comment: the two
/// DTO sets are in different namespaces with no reference between them, so a rename on either
/// side is free and silent. The parity is a claim about the product, and a claim nothing
/// checks decays into a claim that used to be true. Property NAMES and TYPES are compared,
/// because the client sees exactly those two things and nothing else.
/// </para>
/// <para>
/// <b>What is deliberately NOT asserted: that they are the same type.</b> They must not be.
/// The whole slice turns on <c>microclimate_invitations</c> and <c>survey_invitations</c>
/// being different tables, and a shared DTO is one short step from a shared notification
/// payload -- which is how a microclimate id ends up in a field only ever looked up in the
/// other table. Identical shape, separate types, is the point.
/// </para>
/// </summary>
public class InvitationShapeParityTests
{
    /// <summary>
    /// Positional record parameters, in declaration order, as <c>name:type</c>.
    ///
    /// Read off the primary constructor rather than off the properties: the constructor is
    /// the ordered thing, and the order is part of the shape a positional record publishes.
    /// The type is simplified to its name so that <c>SurveyAnonymityGuaranteeDto</c> and
    /// <c>MicroclimateAnonymityGuaranteeDto</c> can be compared under a caller-supplied alias
    /// -- they are the two members that are SUPPOSED to differ.
    /// </summary>
    private static string[] ShapeOf(Type record, Func<string, string> normalise)
    {
        var constructor = record.GetConstructors()
            .OrderByDescending(c => c.GetParameters().Length)
            .First();

        return [.. constructor.GetParameters().Select(p => $"{p.Name}:{normalise(TypeNameOf(p.ParameterType))}")];
    }

    private static string TypeNameOf(Type type)
        => type.IsGenericType
            ? $"{type.Name[..type.Name.IndexOf('`', StringComparison.Ordinal)]}<{string.Join(",", type.GetGenericArguments().Select(TypeNameOf))}>"
            : type.Name;

    /// <summary>
    /// The domain word each surface uses for its own parent, and the anonymity DTO's own
    /// name, mapped to one placeholder. Everything else must match verbatim.
    /// </summary>
    private static string Normalise(string typeName)
        => typeName
            .Replace("MicroclimateAnonymityGuaranteeDto", "AnonymityGuaranteeDto", StringComparison.Ordinal)
            .Replace("SurveyAnonymityGuaranteeDto", "AnonymityGuaranteeDto", StringComparison.Ordinal);

    [Fact]
    public void The_two_state_results_have_the_same_shape()
        => Assert.Equal(
            ShapeOf(typeof(SurveyInvitationStateResult), Normalise),
            ShapeOf(typeof(MicroclimateInvitationStateResult), Normalise));

    [Fact]
    public void The_two_anonymity_guarantees_have_the_same_shape()
        => Assert.Equal(
            ShapeOf(typeof(SurveyAnonymityGuaranteeDto), Normalise),
            ShapeOf(typeof(MicroclimateAnonymityGuaranteeDto), Normalise));

    [Fact]
    public void The_two_summaries_have_the_same_shape()
        => Assert.Equal(
            ShapeOf(typeof(SurveyInvitationSummaryDto), Normalise),
            ShapeOf(typeof(MicroclimateInvitationSummaryDto), Normalise));

    /// <summary>
    /// The invitation detail differs in exactly one member and the difference is named here so
    /// it cannot grow quietly: the survey row points at a <c>surveyId</c> and the microclimate
    /// row at a <c>microclimateId</c>. Everything else -- the five timestamps, the derived
    /// <c>isExpired</c>, the reminder counters -- is identical, which is what lets one table
    /// component draw both.
    /// </summary>
    [Fact]
    public void The_two_invitation_details_differ_only_in_which_parent_they_name()
    {
        var survey = ShapeOf(typeof(SurveyInvitationDetail), Normalise);
        var microclimate = ShapeOf(typeof(MicroclimateInvitationDetail), Normalise);

        Assert.Equal(
            survey.Select(m => m.Replace("SurveyId:", "ParentId:", StringComparison.Ordinal)),
            microclimate.Select(m => m.Replace("MicroclimateId:", "ParentId:", StringComparison.Ordinal)));

        // Guard the guard: the substitution above really did fire on both sides, so a future
        // rename that made both members some third name cannot pass by matching each other.
        Assert.Contains("SurveyId:Guid", survey);
        Assert.Contains("MicroclimateId:Guid", microclimate);
    }

    /// <summary>
    /// And they are NOT the same type, which is the half of the design a parity test could
    /// easily be read as arguing against.
    /// </summary>
    [Fact]
    public void They_remain_separate_types_over_separate_tables()
    {
        Assert.NotEqual(typeof(SurveyInvitationStateResult), typeof(MicroclimateInvitationStateResult));
        Assert.NotEqual(typeof(SurveyInvitationDetail), typeof(MicroclimateInvitationDetail));
        Assert.NotEqual(typeof(SurveyAnonymityGuaranteeDto), typeof(MicroclimateAnonymityGuaranteeDto));

        Assert.NotEqual(
            typeof(SurveyInvitationStateResult).Namespace,
            typeof(MicroclimateInvitationStateResult).Namespace);
    }
}
