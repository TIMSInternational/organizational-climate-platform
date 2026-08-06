using ClimateProject.Domain.Entities;
using ClimateProject.Infrastructure.Persistence;

namespace ClimateProject.IntegrationTests.Support;

// Options stopped being a text[] column on demographic_fields and became rows with a
// stable, locale-independent value (#195). Seeding them is now three lines rather than
// an array literal, so it lives here instead of in five test files.
//
// The seeded value is the label verbatim, which is exactly what the migration does to
// existing rows -- so a test seeding "Remote" still matches a user_demographics row
// holding "Remote", the same way production data does.
internal static class DemographicOptionSeed
{
    public static void Add(ClimateProjectDbContext db, Guid fieldId, IEnumerable<string>? labels)
    {
        if (labels is null)
        {
            return;
        }

        var order = 0;
        foreach (var label in labels)
        {
            db.DemographicFieldOptions.Add(new DemographicFieldOption
            {
                DemographicFieldId = fieldId,
                Order = order++,
                Value = label,
                LabelEn = label,
            });
        }
    }
}
