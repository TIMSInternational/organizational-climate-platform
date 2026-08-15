using System.Runtime.CompilerServices;
using MongoDB.Driver;

namespace ClimateProject.DataMigration.Legacy;

/// <summary>
/// A legacy collection the migration can read: its Mongo collection name, its CLR stub
/// type, and streaming access to its documents. Non-generic so the census and the runner
/// can hold all 35 in one list.
/// </summary>
public interface ILegacyCollectionReader
{
    string CollectionName { get; }

    Type DocumentType { get; }

    /// <summary>
    /// Exact document count, for the per-collection reconciliation counts. Exact
    /// (<c>CountDocuments</c>, not <c>EstimatedDocumentCount</c>) because the design's
    /// reconciliation layer 1 compares this number against rows written plus skips that
    /// sum to the difference; an estimate would make that arithmetic unfalsifiable.
    /// </summary>
    Task<long> CountAsync(IMongoDatabase database, CancellationToken cancellationToken);

    IAsyncEnumerable<LegacyDocument> ReadAllAsync(IMongoDatabase database, CancellationToken cancellationToken);
}

/// <summary>
/// The one reader implementation, bound to a collection name per stub type in
/// <see cref="LegacyCollections"/>.
/// </summary>
public sealed class LegacyCollectionReader<TDocument> : ILegacyCollectionReader
    where TDocument : LegacyDocument
{
    public LegacyCollectionReader(string collectionName)
    {
        ArgumentException.ThrowIfNullOrEmpty(collectionName);
        CollectionName = collectionName;
    }

    public string CollectionName { get; }

    public Type DocumentType => typeof(TDocument);

    public Task<long> CountAsync(IMongoDatabase database, CancellationToken cancellationToken)
        => database.GetCollection<TDocument>(CollectionName)
            .CountDocumentsAsync(FilterDefinition<TDocument>.Empty, options: null, cancellationToken);

    /// <summary>
    /// Streams every document in ascending <c>_id</c> order. The order is load-bearing
    /// twice over: the design's content spot-checks sample "deterministically, by _id
    /// ordering, so dry runs and the real run check the same ones", and a resumed run can
    /// only skip cheaply past already-loaded documents if two reads of the same collection
    /// enumerate identically. Batched cursor, never a materialised list - Response is the
    /// volume driver and its row count is unknown until a dump exists.
    /// </summary>
    public async IAsyncEnumerable<LegacyDocument> ReadAllAsync(
        IMongoDatabase database,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        var collection = database.GetCollection<TDocument>(CollectionName);
        var options = new FindOptions<TDocument>
        {
            Sort = Builders<TDocument>.Sort.Ascending(document => document.Id),
            BatchSize = 500,
        };

        using var cursor = await collection.FindAsync(FilterDefinition<TDocument>.Empty, options, cancellationToken);
        while (await cursor.MoveNextAsync(cancellationToken))
        {
            foreach (var document in cursor.Current)
            {
                yield return document;
            }
        }
    }
}
