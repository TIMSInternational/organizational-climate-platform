using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace ClimateProject.DataMigration.Legacy;

/// <summary>
/// Base shape of every legacy document the readers can see: the <c>_id</c>, and a
/// catch-all for everything else.
///
/// The catch-all is the honesty mechanism, not a convenience. Mongo is schemaless in
/// practice and the design doc warns to expect documents that do not match the nominal
/// Mongoose model; the driver's default is to THROW on elements the CLR type does not
/// declare, and the tempting alternative - ignoring extra elements - is how a field
/// silently vanishes with matching row counts (the doc's <c>password_hash</c>
/// <c>select: false</c> finding is exactly that failure shape). <see cref="Extra"/> keeps
/// every undeclared field visible, so as sub-issue B types real properties onto these
/// stubs, anything left in <c>Extra</c> at load time is by definition unmapped and
/// reportable.
/// </summary>
public abstract class LegacyDocument
{
    [BsonId]
    public ObjectId Id { get; set; }

    [BsonExtraElements]
    public BsonDocument? Extra { get; set; }
}
