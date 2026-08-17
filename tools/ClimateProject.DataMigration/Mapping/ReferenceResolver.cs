using MongoDB.Bson;

namespace ClimateProject.DataMigration.Mapping;

public enum ReferenceKind
{
    /// <summary>The field was absent or empty - not an error, the column allows NULL or the row is skipped.</summary>
    Absent,

    /// <summary>Valid ObjectId hex whose derived Guid exists in the target set.</summary>
    Resolved,

    /// <summary>Valid ObjectId hex, but no such document was migrated from the referenced collection.</summary>
    Dangling,

    /// <summary>Not ObjectId hex at all - typos, empty strings, the literal "undefined".</summary>
    Malformed,
}

public sealed record ReferenceClassification(ReferenceKind Kind, Guid? TargetId);

/// <summary>
/// The classification pass the design doc mandates: every legacy cross-collection
/// reference is an unvalidated string, so each is classified resolved / dangling /
/// malformed BEFORE any insert depends on it. Dangling and malformed go to the report
/// and load as NULL where the column allows it; a non-nullable FK with an unresolvable
/// reference is a reported skip, never an abort.
/// </summary>
public static class ReferenceResolver
{
    public static ReferenceClassification Classify(
        string referencedCollection,
        string? reference,
        IReadOnlySet<Guid> migratedTargets)
    {
        if (string.IsNullOrWhiteSpace(reference))
        {
            return new ReferenceClassification(ReferenceKind.Absent, null);
        }

        if (!ObjectId.TryParse(reference.Trim(), out var objectId))
        {
            return new ReferenceClassification(ReferenceKind.Malformed, null);
        }

        var target = MigrationIds.For(referencedCollection, objectId);
        return migratedTargets.Contains(target)
            ? new ReferenceClassification(ReferenceKind.Resolved, target)
            : new ReferenceClassification(ReferenceKind.Dangling, null);
    }
}
