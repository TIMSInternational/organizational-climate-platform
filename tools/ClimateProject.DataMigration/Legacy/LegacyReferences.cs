using MongoDB.Bson;

namespace ClimateProject.DataMigration.Legacy;

/// <summary>
/// Normalises a legacy cross-collection reference to the hex string the rest of the
/// migration speaks.
///
/// The design doc states the rule loudly - "references are strings, not ObjectIds" -
/// and it holds for every model but one: <see cref="LegacySurveyAuditLog"/> declares
/// <c>survey_id</c> and <c>user_id</c> as <c>Schema.Types.ObjectId</c>. Mongoose
/// enforced that only for documents it wrote itself, so both shapes can coexist in one
/// collection, and a reader that assumed either would throw on the other.
///
/// Anything that is neither an ObjectId nor a string returns null, which the callers
/// classify as malformed and report - never a silent skip.
/// </summary>
public static class LegacyReferences
{
    public static string? HexOf(BsonValue? value) => value?.BsonType switch
    {
        BsonType.ObjectId => value.AsObjectId.ToString(),
        BsonType.String => value.AsString,
        _ => null,
    };
}
