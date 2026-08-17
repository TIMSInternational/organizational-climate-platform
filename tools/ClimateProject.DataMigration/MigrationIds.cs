using ClimateProject.Application.Scheduling;
using MongoDB.Bson;

namespace ClimateProject.DataMigration;

/// <summary>
/// The deterministic identity scheme from the ETL design
/// (docs/superpowers/specs/2026-08-03-mongo-to-postgres-etl-design.md):
/// <c>newId(collection, objectId) = uuidv5(MIGRATION_NAMESPACE, collection + ":" + objectId.hex)</c>.
///
/// Every target Guid is a pure function of the source document's collection and Mongo
/// <c>_id</c>. That single property is what makes the migration idempotent (re-running
/// derives the same keys, so every write is an upsert), resumable (a run that dies at
/// collection 28 of 32 restarts anywhere with no checkpoint) and reconcilable (any legacy
/// <c>_id</c> can be turned back into the row it should have become, without migration
/// state).
///
/// The v5 construction is <see cref="DeterministicNotificationId.Create"/> - the repo's
/// one existing, RFC-test-vector-proven implementation - deliberately NOT reimplemented
/// here. Its own doc comment already commits to matching this ETL's scheme; two
/// implementations of "the same" derivation is how they silently diverge.
/// </summary>
public static class MigrationIds
{
    /// <summary>
    /// Fixed forever, and recorded in the design doc's 2026-08-15 addendum. Changing it
    /// re-keys the entire migrated database: every previously loaded row would be treated
    /// as absent on the next run and duplicated under new ids. It is a constant in source,
    /// never configuration, for the same reason
    /// <see cref="DeterministicNotificationId.DigestNamespace"/> is.
    /// </summary>
    public static readonly Guid MigrationNamespace = new("1ad51692-845e-4f16-ac97-c8f692842472");

    /// <summary>The target id for the document <paramref name="legacyId"/> in <paramref name="collection"/>.</summary>
    public static Guid For(string collection, ObjectId legacyId)
    {
        ArgumentException.ThrowIfNullOrEmpty(collection);

        // ObjectId.ToString() is the canonical 24-char lowercase hex - the ".hex" of the
        // design's formula.
        return DeterministicNotificationId.Create(MigrationNamespace, collection + ":" + legacyId.ToString());
    }

    /// <summary>
    /// <see cref="For(string, ObjectId)"/> for callers holding a legacy reference as a raw
    /// string - which is how legacy documents store EVERY cross-collection reference
    /// (<c>company_id</c>, <c>department_id</c>, <c>manager_id</c> are all plain strings
    /// Mongo never validated).
    ///
    /// Throws on anything that is not valid ObjectId hex. That is the contract, not a
    /// convenience: a malformed reference ("", "undefined", a typo) must be routed to the
    /// data-quality report by the caller, never silently given a derived id - an id derived
    /// from garbage is unreachable garbage with a valid-looking key. Parsing also
    /// canonicalises case, so a reference stored as uppercase hex derives the same id as
    /// the document's own <c>_id</c>.
    /// </summary>
    public static Guid For(string collection, string legacyIdHex)
    {
        ArgumentException.ThrowIfNullOrEmpty(collection);

        if (!ObjectId.TryParse(legacyIdHex, out var legacyId))
        {
            throw new ArgumentException(
                $"'{legacyIdHex}' is not a valid ObjectId. Malformed legacy references belong in the " +
                "data-quality report (design doc, 'References are strings, not ObjectIds'), not in the id space.",
                nameof(legacyIdHex));
        }

        return For(collection, legacyId);
    }

    /// <summary>
    /// The target id for a subdocument embedded in <paramref name="parentId"/>'s document -
    /// legacy survey questions are the first case: they live inside the survey document
    /// with a string <c>id</c> of their own and no collection, so the design formula gets
    /// a scoped extension: <c>collection + ":" + parent.hex + ":" + scope + ":" + key</c>.
    ///
    /// The child key is NOT required to be ObjectId hex (the legacy product minted question
    /// ids via <c>new ObjectId().toString()</c>, but Mongo never validated them) - any
    /// non-empty string is a legal key, because uniqueness is scoped by the parent. What
    /// matters is that the derivation is reachable from a referencing document: a legacy
    /// Response carries <c>survey_id</c> plus each answer's <c>question_id</c>, which is
    /// exactly (parent, key), so the Response slice re-derives these ids without a lookup
    /// table - the same property <see cref="For(string, ObjectId)"/> gives collections.
    /// </summary>
    public static Guid ForChild(string collection, ObjectId parentId, string childScope, string childKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(collection);
        ArgumentException.ThrowIfNullOrEmpty(childScope);
        ArgumentException.ThrowIfNullOrEmpty(childKey);

        return DeterministicNotificationId.Create(
            MigrationNamespace, collection + ":" + parentId.ToString() + ":" + childScope + ":" + childKey);
    }
}
