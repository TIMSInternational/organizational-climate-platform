using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Anthropic;
using Anthropic.Bedrock;
using Anthropic.Exceptions;
using Anthropic.Models.Beta.Messages;
using ClimateProject.Application.OrgStructure.Intake;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace ClimateProject.Infrastructure.OrgStructure;

/// <summary>
/// Reads an <see cref="IntakeProfile"/> — the masked shape of a client's spreadsheet — and asks
/// Claude how it maps onto this platform. One request per file, whatever its length; the answer
/// is applied to the rows by <see cref="IntakeMappingApplier"/> on this server.
///
/// <para><b>Configuration.</b> <c>Intake:Ai:Provider</c> picks where Claude is reached:
/// <list type="bullet">
/// <item><c>anthropic</c> (default) — the Claude API, with <c>Anthropic:ApiKey</c> (user-secrets
/// locally; falls back to the <c>ANTHROPIC_API_KEY</c> environment variable).</item>
/// <item><c>bedrock</c> — Amazon Bedrock through the Mantle (Messages API) endpoint in
/// <c>Intake:Ai:AwsRegion</c> (default us-east-1), authenticated by a Bedrock API key
/// (<c>Intake:Ai:BedrockApiKey</c>, falling back to the <c>AWS_BEARER_TOKEN_BEDROCK</c>
/// environment variable AWS's own tools use) or, without one, by SigV4 with the AWS profile
/// <c>Intake:Ai:AwsProfile</c>.
/// Bedrock has no server-side refusal fallback, so a declined request falls through to the
/// header-word mapping like any other failure.</item>
/// </list>
/// Plus <c>Intake:Ai:Enabled</c> (default true), <c>Intake:Ai:Model</c> (default
/// <c>claude-opus-5-5</c>; the <c>anthropic.</c> prefix Bedrock needs is added for it) and
/// <c>Intake:Ai:Effort</c> (default <c>medium</c>). Unconfigured means <see cref="IsConfigured"/>
/// is false and the endpoint falls back to header words — it never tries a request it knows will
/// fail.</para>
///
/// <para><b>What is logged.</b> The outcome, the model, token counts and the duration. Never the
/// request or the response: both describe a client's organisation.</para>
/// </summary>
public sealed class ClaudeIntakeMappingModel(IConfiguration configuration, ILogger<ClaudeIntakeMappingModel> logger)
    : IIntakeMappingModel
{
    public const string DefaultModel = "claude-opus-5-5";

    /// <summary>A mapping is one short answer; past this the admin is better served by the fallback.</summary>
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(90);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    private readonly Lazy<IAnthropicClient?> _client = new(() =>
    {
        if (IsBedrock(configuration))
        {
            var region = configuration["Intake:Ai:AwsRegion"] is { Length: > 0 } configured ? configured : "us-east-1";
            return BedrockApiKey(configuration) is { } apiKey
                ? new AnthropicBedrockMantleClient(new MantleAwsClientOptions { AwsRegion = region, ApiKey = apiKey })
                : new AnthropicBedrockMantleClient(new MantleAwsClientOptions { AwsRegion = region, AwsProfile = configuration["Intake:Ai:AwsProfile"] });
        }

        var key = ApiKey(configuration);
        return key is null ? null : new AnthropicClient { ApiKey = key };
    });

    public bool IsConfigured =>
        configuration.GetValue("Intake:Ai:Enabled", true)
        && (IsBedrock(configuration)
            ? BedrockApiKey(configuration) is not null || !string.IsNullOrWhiteSpace(configuration["Intake:Ai:AwsProfile"])
            : ApiKey(configuration) is not null);

    private static string? BedrockApiKey(IConfiguration configuration)
    {
        var key = configuration["Intake:Ai:BedrockApiKey"];
        if (string.IsNullOrWhiteSpace(key))
        {
            key = Environment.GetEnvironmentVariable("AWS_BEARER_TOKEN_BEDROCK");
        }

        return string.IsNullOrWhiteSpace(key) ? null : key.Trim();
    }

    private static bool IsBedrock(IConfiguration configuration) =>
        string.Equals(configuration["Intake:Ai:Provider"], "bedrock", StringComparison.OrdinalIgnoreCase);

    private static string? ApiKey(IConfiguration configuration)
    {
        var key = configuration["Anthropic:ApiKey"];
        if (string.IsNullOrWhiteSpace(key))
        {
            key = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
        }

        return string.IsNullOrWhiteSpace(key) ? null : key.Trim();
    }

    public async Task<IntakeModelResult> MapAsync(
        IntakeProfile profile,
        IntakeTargets targets,
        string language,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);
        ArgumentNullException.ThrowIfNull(targets);

        var model = configuration["Intake:Ai:Model"] is { Length: > 0 } configured ? configured : DefaultModel;
        var bedrock = IsBedrock(configuration);
        var requestModel = bedrock && !model.StartsWith("anthropic.", StringComparison.Ordinal) ? "anthropic." + model : model;
        if (!IsConfigured || _client.Value is not { } client)
        {
            return IntakeModelResult.Failed("ai_unavailable", model);
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        var clock = Stopwatch.StartNew();

        try
        {
            var request = new MessageCreateParams
            {
                Model = requestModel,
                MaxTokens = 16000,
                OutputConfig = new BetaOutputConfig
                {
                    Effort = configuration["Intake:Ai:Effort"] switch
                    {
                        "low" => Effort.Low,
                        "high" => Effort.High,
                        _ => Effort.Medium,
                    },
                    Format = new BetaJsonOutputFormat { Schema = OutputSchema },
                },
                System = new List<BetaTextBlockParam>
                {
                    new() { Text = SystemPrompt, CacheControl = new BetaCacheControlEphemeral() },
                },
                Messages =
                [
                    new()
                    {
                        Role = Role.User,
                        Content = JsonSerializer.Serialize(new { language, targets, profile }, Json),
                    },
                ],
            };

            if (!bedrock)
            {
                // A declined request is re-served inside this same call by the fallback the
                // platform routes its refusal category to ("default"), so an intake does not
                // dead-end on a classifier's false positive. Claude API only: Bedrock has no
                // server-side fallback, and there a refusal falls through to header words.
                request = request with
                {
                    Betas = ["server-side-fallback-2026-07-01"],
                    Fallbacks = new Default(),
                };
            }

            var response = await client.Beta.Messages.Create(request, timeout.Token);
            var inputTokens = response.Usage.InputTokens;
            var outputTokens = response.Usage.OutputTokens;

            if (response.StopReason == "refusal")
            {
                logger.LogWarning("Intake mapping declined by {Model} after {Ms} ms", model, clock.ElapsedMilliseconds);
                return new IntakeModelResult(null, "ai_refused", model, inputTokens, outputTokens);
            }

            if (response.StopReason == "max_tokens")
            {
                logger.LogWarning("Intake mapping truncated by max_tokens on {Model}", model);
                return new IntakeModelResult(null, "ai_failed", model, inputTokens, outputTokens);
            }

            var text = string.Concat(response.Content.Select(b => b.Value).OfType<BetaTextBlock>().Select(t => t.Text));
            var mapping = JsonSerializer.Deserialize<IntakeMapping>(text, Json);
            if (mapping is null)
            {
                return new IntakeModelResult(null, "ai_failed", model, inputTokens, outputTokens);
            }

            logger.LogInformation(
                "Intake mapping by {Model}: {InputTokens} in / {OutputTokens} out, {Ms} ms",
                model, inputTokens, outputTokens, clock.ElapsedMilliseconds);
            return new IntakeModelResult(mapping, null, model, inputTokens, outputTokens);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Intake mapping timed out after {Ms} ms on {Model}", clock.ElapsedMilliseconds, model);
            return IntakeModelResult.Failed("ai_failed", model);
        }
        catch (AnthropicUnauthorizedException)
        {
            logger.LogError("Intake mapping: the Anthropic key was rejected (401). Check Anthropic:ApiKey.");
            return IntakeModelResult.Failed("ai_unavailable", model);
        }
        catch (AnthropicRateLimitException)
        {
            logger.LogWarning("Intake mapping rate-limited on {Model}", model);
            return IntakeModelResult.Failed("ai_failed", model);
        }
        catch (AnthropicApiException ex)
        {
            logger.LogWarning("Intake mapping failed on {Model}: {Type}", model, ex.GetType().Name);
            return IntakeModelResult.Failed("ai_failed", model);
        }
        catch (JsonException)
        {
            logger.LogWarning("Intake mapping from {Model} did not parse as the requested schema", model);
            return IntakeModelResult.Failed("ai_failed", model);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning("Intake mapping could not reach the provider: {Message}", ex.Message);
            return IntakeModelResult.Failed("ai_failed", model);
        }
    }

    internal const string SystemPrompt = """
        You map a company's employee spreadsheet onto an organisational-climate survey platform.
        You receive JSON with three keys:
        - "targets": what can be mapped onto — the company's name and email domain, its existing
          departments, and its demographic fields (key, label, type, and for "select" fields the
          allowed stored values).
        - "profile": the file's structure. Values of personal columns are MASKED ("Ma*** Ji***",
          "m***@empresa.cr", "1987-**-**", "#########"); category columns (job titles, areas,
          sites, gender, age bands) list their distinct values with counts. Never try to
          reconstruct a masked value; the shape is all you need.
        - "language": "es" or "en" — write "summary" and every "reason" in that language.

        Return one mapping for the sheet that holds the people roster:

        sheet, headerRow: the roster sheet's name and the 1-based row holding the column names.
        suggestedHeaderRow is a heuristic; correct it if the preview shows otherwise (title rows,
        blank spacers and logos often sit above the header).

        columns: EVERY column of that sheet exactly once, with a target:
        - "name" for a single full-name column; "first_name" and "last_name" when the name is
          split (several given-name or surname columns: pick the most complete one of each).
        - "email": the address people receive mail at. If there are two, prefer the
          institutional/work one on the company's domain over a personal one.
        - "role": the column that says what kind of position someone holds (Cargo, Puesto,
          Rol, Posición, Job title, Nivel). At most one.
        - "department": the organisational unit (Área, Departamento, Unidad, Gerencia, Dirección).
          At most one; prefer the most specific unit that is not a site/location.
        - "demographic" with demographicField set to a field key, when the column holds what that
          field asks (sede/site, género, antigüedad, rango de edad, tipo de contrato, ...).
          Use each field at most once.
        - "ignore" for everything else — identity numbers, phones, addresses, salaries, dates of
          birth unless a date field explicitly asks for one, internal codes.
        confidence: "high" when header and values agree, "medium" when inferred from values or an
        ambiguous header, "low" when guessing. reason: one short sentence the HR admin will read,
        e.g. "Los valores son correos del dominio de la empresa".

        nameOrder: "last_first" when the full-name column writes surnames first
        ("Ro*** Pé***, An*** Ma***" — a comma after the surnames), otherwise "first_last".

        defaultRole: the role for rows with no role value — normally "employee".

        roleValues: one entry for EVERY distinct value listed for the role column, mapped to
        exactly one platform role:
        - "leader": heads an area, department or company (gerente, director, jefe de área o de
          departamento, jefatura, líder de área, head of, VP, C-level).
        - "supervisor": directly supervises a team without heading a unit (supervisor,
          coordinador, encargado, jefe de turno, team lead, capataz).
        - "employee": everyone else (analista, asistente, técnico, operario, ejecutivo, pasante).
        Admin roles do not exist here; never output anything but these three.

        departmentValues: one entry for EVERY distinct value listed for the department column.
        - Same unit as an existing department (same meaning: synonyms, abbreviations such as
          "RRHH" for a people/HR department, other language, accents or casing) → department =
          that existing name exactly, createNew = false.
        - Clearly a unit the company does not have yet → createNew = true and department = a clean
          proposed name (Title Case, no codes, in the file's language).
        - Do not merge two different units into one department. If unsure, prefer createNew with
          confidence "low" over a wrong match.

        demographicValues: for every demographic column whose field is "select", one entry per
        distinct value listed: field, source (the value as listed), target (one of that field's
        allowed values exactly, or null if none fits). Bucket numbers into ranges when the options
        are ranges (an age 34 → "30-39"). Nothing for text/number/date fields.

        summary: two or three plain sentences for the HR admin: what the file contains (how many
        people, which information), and the decisions worth their attention (departments to be
        created, columns left out on purpose, values that could not be mapped). Do not mention
        masking or JSON. Do not state numbers the profile does not give.
        """;

    private static readonly IReadOnlyDictionary<string, JsonElement> OutputSchema = BuildSchema();

    private static Dictionary<string, JsonElement> BuildSchema()
    {
        static object Obj(object properties, params string[] required) =>
            new Dictionary<string, object> { ["type"] = "object", ["properties"] = properties, ["required"] = required, ["additionalProperties"] = false };
        static object Str() => new { type = "string" };
        static object NullableStr() => new { type = new[] { "string", "null" } };
        static object Enum(params string[] values) => new { type = "string", @enum = values };
        static object Arr(object items) => new { type = "array", items };
        var confidence = Enum("high", "medium", "low");

        var schema = Obj(
            new Dictionary<string, object>
            {
                ["sheet"] = Str(),
                ["headerRow"] = new { type = "integer" },
                ["columns"] = Arr(Obj(
                    new Dictionary<string, object>
                    {
                        ["column"] = new { type = "integer" },
                        ["header"] = Str(),
                        ["target"] = Enum(IntakeTargetFields.All),
                        ["demographicField"] = NullableStr(),
                        ["confidence"] = confidence,
                        ["reason"] = NullableStr(),
                    },
                    "column", "header", "target", "demographicField", "confidence", "reason")),
                ["nameOrder"] = Enum("first_last", "last_first"),
                ["defaultRole"] = Enum("employee", "leader", "supervisor"),
                ["roleValues"] = Arr(Obj(
                    new Dictionary<string, object>
                    {
                        ["source"] = Str(),
                        ["target"] = Enum("employee", "leader", "supervisor"),
                        ["confidence"] = confidence,
                        ["reason"] = NullableStr(),
                    },
                    "source", "target", "confidence", "reason")),
                ["departmentValues"] = Arr(Obj(
                    new Dictionary<string, object>
                    {
                        ["source"] = Str(),
                        ["department"] = NullableStr(),
                        ["createNew"] = new { type = "boolean" },
                        ["confidence"] = confidence,
                        ["reason"] = NullableStr(),
                    },
                    "source", "department", "createNew", "confidence", "reason")),
                ["demographicValues"] = Arr(Obj(
                    new Dictionary<string, object>
                    {
                        ["field"] = Str(),
                        ["source"] = Str(),
                        ["target"] = NullableStr(),
                        ["confidence"] = confidence,
                    },
                    "field", "source", "target", "confidence")),
                ["summary"] = NullableStr(),
            },
            "sheet", "headerRow", "columns", "nameOrder", "defaultRole", "roleValues", "departmentValues", "demographicValues", "summary");

        var element = JsonSerializer.SerializeToElement(schema);
        return element.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());
    }
}
