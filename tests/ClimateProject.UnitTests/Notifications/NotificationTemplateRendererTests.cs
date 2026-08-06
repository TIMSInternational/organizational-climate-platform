using ClimateProject.Application.Notifications;

namespace ClimateProject.UnitTests.Notifications;

/// <summary>
/// #96. Substitution is the other half of the legacy notification-template hazard: the
/// condition evaluator ran strings as code (#73, covered by
/// <see cref="NotificationConditionParserTests"/>), and the renderer dropped variable
/// values straight into an HTML email body. These tests pin that a value is escaped when
/// it lands in HTML, that an admin's own markup is not, and that a placeholder is only
/// ever a name lookup and never an expression.
/// </summary>
public class NotificationTemplateRendererTests
{
    private static Dictionary<string, string?> Values(params (string Name, string? Value)[] pairs)
        => pairs.ToDictionary(p => p.Name, p => p.Value, StringComparer.Ordinal);

    [Fact]
    public void Substitutes_a_declared_variable()
    {
        var result = NotificationTemplateRenderer.Render(
            "Hola {{userName}}, tienes {{count}} encuestas.",
            Values(("userName", "Ana"), ("count", "3")),
            escapeHtml: false);

        Assert.Equal("Hola Ana, tienes 3 encuestas.", result);
    }

    [Fact]
    public void Tolerates_whitespace_and_dotted_names_inside_the_braces()
    {
        var result = NotificationTemplateRenderer.Render(
            "{{ user.name }} / {{survey.title}}",
            Values(("user.name", "Ana"), ("survey.title", "Pulso")),
            escapeHtml: false);

        Assert.Equal("Ana / Pulso", result);
    }

    [Fact]
    public void Escapes_a_substituted_value_in_an_html_body()
    {
        var result = NotificationTemplateRenderer.Render(
            "<p>Hello {{userName}}</p>",
            Values(("userName", "<script>alert('xss')</script>")),
            escapeHtml: true);

        Assert.Equal("<p>Hello &lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;</p>", result);
        Assert.DoesNotContain("<script>", result, StringComparison.Ordinal);
    }

    [Fact]
    public void Escapes_attribute_breaking_characters_too()
    {
        // A value landing inside an attribute must not be able to close it. HtmlEncode
        // covers both quote forms, which is why the renderer does not need to know
        // whether the placeholder sat in text or in an attribute.
        var result = NotificationTemplateRenderer.Render(
            """<a title="{{userName}}">x</a>""",
            Values(("userName", """a" onmouseover="alert(1)""")),
            escapeHtml: true);

        Assert.Equal("""<a title="a&quot; onmouseover=&quot;alert(1)">x</a>""", result);
    }

    [Fact]
    public void Leaves_the_authors_own_markup_alone()
    {
        // The template body is authored by an admin and is meant to contain markup.
        // Encoding the whole document instead of each substituted value would render
        // the admin's email as visible angle brackets.
        var result = NotificationTemplateRenderer.Render(
            "<h1>Recordatorio</h1><p>{{userName}}</p>",
            Values(("userName", "Ana")),
            escapeHtml: true);

        Assert.Equal("<h1>Recordatorio</h1><p>Ana</p>", result);
    }

    [Fact]
    public void Does_not_escape_a_value_in_a_plain_text_body()
    {
        var result = NotificationTemplateRenderer.Render(
            "De: {{department}}",
            Values(("department", "I+D & Calidad")),
            escapeHtml: false);

        Assert.Equal("De: I+D & Calidad", result);
    }

    [Fact]
    public void An_unresolved_placeholder_renders_empty_rather_than_leaking_its_name()
    {
        var result = NotificationTemplateRenderer.Render(
            "Hola {{userName}}!",
            Values(("other", "x")),
            escapeHtml: false);

        Assert.Equal("Hola !", result);
    }

    [Theory]
    // A placeholder is a name, not an expression. None of these is a placeholder at all,
    // so each is left verbatim -- there is no path on which the renderer evaluates
    // anything.
    [InlineData("{{ 1 + 1 }}")]
    [InlineData("{{ constructor.constructor('return 1')() }}")]
    [InlineData("${userName}")]
    [InlineData("{{userName()}}")]
    public void Never_evaluates_an_expression_in_a_placeholder(string template)
    {
        var result = NotificationTemplateRenderer.Render(template, Values(("userName", "Ana")), escapeHtml: false);

        Assert.Equal(template, result);
    }

    [Fact]
    public void A_substituted_value_containing_a_placeholder_is_not_re_expanded()
    {
        // Single pass by construction: Regex.Replace does not rescan its own output, so a
        // value carrying "{{secret}}" cannot pull another variable into the email.
        var result = NotificationTemplateRenderer.Render(
            "{{userName}}",
            Values(("userName", "{{secret}}"), ("secret", "hunter2")),
            escapeHtml: false);

        Assert.Equal("{{secret}}", result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Passes_an_empty_body_through(string? template)
    {
        Assert.Equal(template, NotificationTemplateRenderer.Render(template, Values(), escapeHtml: true));
    }

    [Fact]
    public void Unwraps_a_json_string_default_so_the_quotes_do_not_reach_the_email()
    {
        Assert.Equal("Equipo", NotificationTemplateRenderer.UnwrapJsonDefault("\"Equipo\""));
    }

    [Theory]
    [InlineData("3", "3")]
    [InlineData("{\"a\":1}", "{\"a\":1}")]
    // A row written before the write-time JSON check existed still renders.
    [InlineData("not json", "not json")]
    public void Renders_a_non_string_default_as_its_text(string stored, string expected)
    {
        Assert.Equal(expected, NotificationTemplateRenderer.UnwrapJsonDefault(stored));
    }

    [Fact]
    public void Treats_a_blank_default_as_absent()
    {
        Assert.Null(NotificationTemplateRenderer.UnwrapJsonDefault(null));
        Assert.Null(NotificationTemplateRenderer.UnwrapJsonDefault("   "));
    }

    [Fact]
    public void A_supplied_value_wins_over_a_declared_default()
    {
        var values = NotificationTemplateRenderer.BuildValues(
            new Dictionary<string, string?> { ["userName"] = "\"Equipo\"", ["count"] = "0" },
            new Dictionary<string, string?> { ["userName"] = "Ana" });

        Assert.Equal("Ana", values["userName"]);
        Assert.Equal("0", values["count"]);
    }

    [Fact]
    public void A_null_supplied_value_falls_back_to_the_default_rather_than_blanking_it()
    {
        var values = NotificationTemplateRenderer.BuildValues(
            new Dictionary<string, string?> { ["userName"] = "\"Equipo\"" },
            new Dictionary<string, string?> { ["userName"] = null });

        Assert.Equal("Equipo", values["userName"]);
    }

    [Fact]
    public void Reports_required_variables_that_ended_up_with_no_value()
    {
        var values = NotificationTemplateRenderer.BuildValues(
            new Dictionary<string, string?> { ["userName"] = null, ["surveyTitle"] = "\"Pulso\"" },
            supplied: null);

        var missing = NotificationTemplateRenderer.FindMissingRequired(["userName", "surveyTitle"], values);

        Assert.Equal(["userName"], missing);
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("\"Equipo\"", true)]
    [InlineData("3", true)]
    [InlineData("{\"a\":1}", true)]
    [InlineData("Equipo", false)]
    [InlineData("{unclosed", false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    public void Validates_json_bound_for_a_jsonb_column(string? json, bool expected)
    {
        // The column is jsonb; without this check an unquoted default reaches Postgres as
        // a 22P02 and surfaces to the admin as a 500 instead of a 400 naming the field.
        Assert.Equal(expected, NotificationTemplateRenderer.IsValidJson(json));
    }
}
