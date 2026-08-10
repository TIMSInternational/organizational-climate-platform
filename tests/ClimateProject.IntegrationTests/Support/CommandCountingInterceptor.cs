using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace ClimateProject.IntegrationTests.Support;

/// <summary>
/// Counts the database commands a request actually sends — the only way to test for an N+1
/// in this codebase that can fail.
///
/// <para>
/// The obvious alternative, counting statements in <c>ToQueryString()</c>, cannot: EF renders
/// exactly one <c>IRelationalCommand</c> from a query and has no way to represent a second
/// round trip in that string, so the count is 1 for every query there has ever been. #132's
/// review found nine assertions built on it, and a deliberately pathological triple-nested
/// correlated subquery scored identically to the real ones. An N+1 is not a translation
/// failure — it translates fine, it just runs N more times — so it has to be observed at
/// execution, not at translation.
/// </para>
///
/// <para>
/// Registered as an <c>IInterceptor</c> in the application service provider by
/// <see cref="AuthWebApplicationFactory"/>, which is how EF discovers interceptors it should
/// resolve from DI. It is safe for every other test class to carry: it increments a counter
/// and does nothing else.
/// </para>
///
/// <para>
/// Not thread-safe against concurrent <em>requests</em> by design — it measures one request
/// at a time. That holds here because <c>Support/AssemblyParallelism.cs</c> disables test
/// parallelisation assembly-wide, so the only traffic while a measurement is in flight is
/// the measured request itself. The increments are interlocked anyway, because a single
/// request may still open more than one scope.
/// </para>
/// </summary>
public sealed class CommandCountingInterceptor : DbCommandInterceptor
{
    private int _count;

    /// <summary>Commands executed since the last <see cref="Reset"/>.</summary>
    public int Count => Volatile.Read(ref _count);

    public void Reset() => Interlocked.Exchange(ref _count, 0);

    public override InterceptionResult<DbDataReader> ReaderExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result)
    {
        Interlocked.Increment(ref _count);
        return base.ReaderExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<DbDataReader> result,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _count);
        return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override InterceptionResult<object> ScalarExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<object> result)
    {
        Interlocked.Increment(ref _count);
        return base.ScalarExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<object> result,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _count);
        return base.ScalarExecutingAsync(command, eventData, result, cancellationToken);
    }

    public override InterceptionResult<int> NonQueryExecuting(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result)
    {
        Interlocked.Increment(ref _count);
        return base.NonQueryExecuting(command, eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
        DbCommand command,
        CommandEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        Interlocked.Increment(ref _count);
        return base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
    }
}
