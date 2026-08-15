using ClimateProject.DataMigration.Legacy;
using MongoDB.Bson;
using MongoDB.Driver;
using Testcontainers.MongoDb;

namespace ClimateProject.DataMigration.Tests;

/// <summary>One Mongo container for the class; each test gets its own database.</summary>
public sealed class MongoContainerFixture : IAsyncLifetime
{
    private readonly MongoDbContainer _container = new MongoDbBuilder("mongo:7.0").Build();

    public MongoClient Client { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        Client = new MongoClient(_container.GetConnectionString());
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();
}

/// <summary>
/// The harness the real ETL will grow inside: readers against an actual Mongo, and the
/// idempotency/resumability SHAPE the design derives from deterministic ids. The load side
/// here is a dictionary standing in for Postgres upserts - the real loader is sub-issues
/// C/D (docs/migration/sub-issues.md); what these tests prove is the property the loader
/// will rely on, on the real driver against a real server.
/// </summary>
public class MongoHarnessTests : IClassFixture<MongoContainerFixture>
{
    private readonly MongoContainerFixture _fixture;

    public MongoHarnessTests(MongoContainerFixture fixture) => _fixture = fixture;

    private static ILegacyCollectionReader Reader(string collection)
        => LegacyCollections.All.Single(reader => reader.CollectionName == collection);

    private static async Task<List<LegacyDocument>> CollectAsync(
        ILegacyCollectionReader reader, IMongoDatabase database)
    {
        var documents = new List<LegacyDocument>();
        await foreach (var document in reader.ReadAllAsync(database, CancellationToken.None))
        {
            documents.Add(document);
        }

        return documents;
    }

    [Fact]
    public async Task A_field_the_stub_does_not_declare_is_captured_not_dropped()
    {
        var database = _fixture.Client.GetDatabase("extra_elements");
        await database.GetCollection<BsonDocument>("users").InsertOneAsync(new BsonDocument
        {
            ["name"] = "Ana",
            ["email"] = "ana@example.com",
            // The design doc's nastiest finding: Mongoose's select:false hid this field
            // from naive reads. The readers here go through the driver, not Mongoose, so
            // it must arrive - and because the stub declares no fields, it must arrive in
            // Extra rather than being silently discarded by the deserializer.
            ["password_hash"] = "$2b$10$abcdefghijklmnopqrstuv",
        });

        var documents = await CollectAsync(Reader("users"), database);

        var user = Assert.Single(documents);
        Assert.NotNull(user.Extra);
        Assert.Equal("$2b$10$abcdefghijklmnopqrstuv", user.Extra["password_hash"].AsString);
        Assert.Equal("Ana", user.Extra["name"].AsString);
    }

    [Fact]
    public async Task Every_reader_reads_the_collection_it_names()
    {
        // Seeds via reader.CollectionName, so what this proves is the reader mechanics -
        // GetCollection binding, exact CountAsync - for all 35. That the names themselves
        // are the right ones is pinned separately against an independent list in
        // LegacyCollectionsTests; together the two mean a typo'd name cannot pass.
        var database = _fixture.Client.GetDatabase("census");
        foreach (var reader in LegacyCollections.All)
        {
            await database.GetCollection<BsonDocument>(reader.CollectionName)
                .InsertOneAsync(new BsonDocument { ["seed"] = reader.CollectionName });
        }

        foreach (var reader in LegacyCollections.All)
        {
            Assert.Equal(1, await reader.CountAsync(database, CancellationToken.None));
        }
    }

    [Fact]
    public async Task Reads_enumerate_in_ascending_id_order_regardless_of_insert_order()
    {
        // Deterministic enumeration is what the design's spot-check sampling ("by _id
        // ordering, so dry runs and the real run check the same ones") and cheap resume
        // both stand on.
        var database = _fixture.Client.GetDatabase("ordering");
        var ids = Enumerable.Range(0, 25).Select(_ => ObjectId.GenerateNewId()).ToList();
        foreach (var id in Enumerable.Reverse(ids))
        {
            await database.GetCollection<BsonDocument>("responses")
                .InsertOneAsync(new BsonDocument { ["_id"] = id });
        }

        var documents = await CollectAsync(Reader("responses"), database);

        Assert.Equal(ids.OrderBy(id => id), documents.Select(document => document.Id));
    }

    [Fact]
    public async Task Reading_twice_derives_identical_keys_so_a_rerun_upserts_instead_of_duplicating()
    {
        var database = _fixture.Client.GetDatabase("idempotency");
        for (var i = 0; i < 10; i++)
        {
            await database.GetCollection<BsonDocument>("companies")
                .InsertOneAsync(new BsonDocument { ["name"] = $"company-{i}" });
        }

        var reader = Reader("companies");
        var sink = new Dictionary<Guid, ObjectId>();

        // Two full runs into the same keyed sink - the shape of "re-running the ETL".
        for (var run = 0; run < 2; run++)
        {
            foreach (var document in await CollectAsync(reader, database))
            {
                sink[MigrationIds.For(reader.CollectionName, document.Id)] = document.Id;
            }
        }

        // Idempotent: the second run re-derived every key, so the sink neither grew nor
        // forked. 10 source documents, 10 rows, twice over.
        Assert.Equal(10, sink.Count);
        Assert.Equal(10, sink.Values.Distinct().Count());
    }

    [Fact]
    public async Task A_run_that_dies_mid_collection_restarts_from_scratch_to_the_same_state()
    {
        var database = _fixture.Client.GetDatabase("resumability");
        foreach (var collection in new[] { "companies", "departments", "users" })
        {
            for (var i = 0; i < 6; i++)
            {
                await database.GetCollection<BsonDocument>(collection)
                    .InsertOneAsync(new BsonDocument { ["n"] = i });
            }
        }

        var readers = new[] { Reader("companies"), Reader("departments"), Reader("users") };

        // Each pass re-reads from Mongo, as a restarted process would.
        async Task<List<(string Collection, ObjectId Id)>> ReadEverythingAsync()
        {
            var read = new List<(string, ObjectId)>();
            foreach (var reader in readers)
            {
                foreach (var document in await CollectAsync(reader, database))
                {
                    read.Add((reader.CollectionName, document.Id));
                }
            }

            return read;
        }

        // The design's resumability claim: failure at collection 28 of 32 must not require
        // starting over - and with deterministic ids, "resume" IS "start over", because
        // re-deriving the same keys makes the replayed writes upserts to no effect. So: a
        // run that dies partway through the second collection, then a naive full restart
        // into the same sink, must land exactly where an uninterrupted run does.
        var interrupted = new Dictionary<Guid, ObjectId>();
        foreach (var (collection, id) in (await ReadEverythingAsync()).Take(9)) // dies mid-"departments"
        {
            interrupted[MigrationIds.For(collection, id)] = id;
        }

        foreach (var (collection, id) in await ReadEverythingAsync()) // the restart
        {
            interrupted[MigrationIds.For(collection, id)] = id;
        }

        var clean = (await ReadEverythingAsync())
            .ToDictionary(pair => MigrationIds.For(pair.Collection, pair.Id), pair => pair.Id);

        Assert.Equal(18, interrupted.Count);
        Assert.Equal(clean, interrupted);
    }
}
