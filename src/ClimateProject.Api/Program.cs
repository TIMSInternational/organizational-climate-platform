var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

var app = builder.Build();

app.MapOpenApi();

app.MapGet("/", () => Results.Redirect("/health"));

app.MapGet("/health", () => Results.Ok(new
{
    service = "climate-project-api",
    status = "ok"
}));

app.MapGet("/version", () => Results.Ok(new VersionResponse(
    Service: "climate-project-api",
    Runtime: Environment.Version.ToString(),
    Environment: app.Environment.EnvironmentName)));

app.Run();

internal sealed record VersionResponse(
    string Service,
    string Runtime,
    string Environment);

public partial class Program;
