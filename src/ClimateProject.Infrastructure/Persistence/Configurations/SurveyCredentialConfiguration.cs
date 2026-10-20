using ClimateProject.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ClimateProject.Infrastructure.Persistence.Configurations;

public class SurveyCredentialConfiguration : IEntityTypeConfiguration<SurveyCredential>
{
    public void Configure(EntityTypeBuilder<SurveyCredential> builder)
    {
        builder.ToTable("survey_credentials");

        // One key per person per survey -- the same grain as SurveyInvitation, deliberately,
        // because the two are minted together and a second credential for the same pair
        // would make "which password is live" unanswerable.
        builder.HasKey(c => new { c.SurveyId, c.UserId });

        builder.Property(c => c.SurveyId).HasColumnName("survey_id");
        builder.Property(c => c.UserId).HasColumnName("user_id");

        builder.Property(c => c.Username).HasColumnName("username").HasMaxLength(64).IsRequired();
        builder.Property(c => c.PasswordHash).HasColumnName("password_hash").HasMaxLength(255).IsRequired();
        builder.Property(c => c.CreatedAt).HasColumnName("created_at").IsRequired();
        builder.Property(c => c.LastSignInAt).HasColumnName("last_sign_in_at");

        // UNIQUE, and it has to be. Sign-in resolves an identifier against users.Username
        // and then against this column; two rows sharing a username would make that lookup
        // answer "which person, which survey?" with a coin toss. The generator is deduped
        // against BOTH namespaces when minting for the same reason.
        builder.HasIndex(c => c.Username).IsUnique();

        // Cascade from the survey, as survey_user_targets does: a credential is part of the
        // survey's distribution, not a record with a life of its own. Deleting a survey that
        // has credentials should take them with it -- they open nothing once it is gone.
        builder.HasOne<Survey>().WithMany().HasForeignKey(c => c.SurveyId).OnDelete(DeleteBehavior.Cascade);

        // Cascade from the user too. A deleted person's key must not outlive them: it is a
        // working sign-in, and the row it points at would be missing.
        builder.HasOne<User>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
