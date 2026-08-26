using ClimateTracking.Application.Scheduling;

namespace ClimateTracking.UnitTests.Scheduling;

/// <summary>
/// The advisory lock key is the whole of the single-flight guarantee: two instances only exclude
/// each other if they compute the same number from the same job name, and two different jobs only
/// run in parallel if they compute different ones. Postgres has no registry behind these
/// integers, so nothing else in the system would notice either mistake.
/// </summary>
public class JobLockKeyTests
{
    [Fact]
    public void The_same_job_name_always_yields_the_same_key()
    {
        // If this were not stable across processes, two instances of the same job would take two
        // different locks and both run -- which is the failure the lease exists to prevent, in a
        // form that looks like it is working.
        Assert.Equal(JobLockKey.For("daily-semaforo"), JobLockKey.For("daily-semaforo"));
    }

    [Fact]
    public void Different_job_names_yield_different_keys()
    {
        Assert.NotEqual(JobLockKey.For("cache-sync"), JobLockKey.For("daily-semaforo"));
    }

    [Theory]
    [InlineData("cache-sync")]
    [InlineData("daily-semaforo")]
    public void A_job_name_is_required(string valid)
    {
        Assert.NotEqual(0, JobLockKey.For(valid));
        Assert.Throws<ArgumentNullException>(() => JobLockKey.For(null!));
        Assert.Throws<ArgumentException>(() => JobLockKey.For("   "));
    }

    [Fact]
    public void The_key_is_namespaced_to_this_service()
    {
        // climate-project derives its keys from "climate-project.job:" + name. Today the two
        // services hold separate databases so they could not collide anyway; the day one of them
        // is pointed at the other's Postgres, this prefix is the only thing stopping a tracking
        // job silently sharing a lock with an unrelated climate-project job of the same name.
        // Recomputing the collision here rather than asserting a magic number keeps the test
        // honest if the hash ever changes.
        var climateProjectStyleKey = KeyWithPrefix("climate-project.job:", "cache-sync");

        Assert.NotEqual(climateProjectStyleKey, JobLockKey.For("cache-sync"));
        Assert.Equal(KeyWithPrefix("climate-tracking.job:", "cache-sync"), JobLockKey.For("cache-sync"));
    }

    private static long KeyWithPrefix(string prefix, string jobName)
    {
        var hash = System.Security.Cryptography.SHA1.HashData(
            System.Text.Encoding.UTF8.GetBytes(prefix + jobName));
        return BitConverter.ToInt64(hash, 0);
    }
}
