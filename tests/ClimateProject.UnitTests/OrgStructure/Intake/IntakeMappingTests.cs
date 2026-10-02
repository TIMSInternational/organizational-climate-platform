using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.OrgStructure.Intake;

namespace ClimateProject.UnitTests.OrgStructure.Intake;

/// <summary>
/// The deterministic half of the AI intake: a mapping (from the model, the template or the admin)
/// meets the actual rows. Every rule here runs on this server, on every row, with no model.
/// </summary>
public class IntakeMappingTests
{
    private static readonly IntakeTargets Targets = new(
        "Grupo Meridiano S.A.",
        "meridiano.cr",
        ["Finanzas", "Ingeniería", "Operaciones", "Personas"],
        [
            new IntakeDemographicTarget("sede", "Sede", "select", ["san_jose", "heredia"]),
            new IntakeDemographicTarget("antiguedad", "Años en la empresa", "number", null),
            new IntakeDemographicTarget("ingreso", "Fecha de ingreso", "date", null),
        ]);

    private static readonly string[][] Roster =
    [
        ["Planilla 2026", "", "", "", "", "", ""],
        ["Nombre completo", "Correo", "Puesto", "Área", "Sede", "Años", "Ingreso"],
        ["ROJAS PÉREZ, ANA MARÍA", "Ana.Rojas@Meridiano.cr", "Gerente de Finanzas", "Finanzas", "San José", "12", "15/03/2014"],
        ["Jiménez Mora, Carlos", "carlos.jimenez@meridiano.cr", "Analista", "finanzas", "Heredia", "3,0", "2023-01-09"],
        ["", "", "", "", "", "", ""],
        ["Vargas Castro, Sofía", "sofia.vargas@gmial.com", "Supervisora de Turno", "RRHH", "San José", "", ""],
        ["Mora Quesada, Luis", "luis.mora@meridiano.cr", "Pasante", "Calidad", "Cartago", "1", ""],
    ];

    private static SheetGrid Grid(string[][] rows, string name = "Personal") =>
        new(name, rows.Select(r => (IReadOnlyList<string>)r).ToList());

    private static IntakeMapping Mapping() => new(
        "Personal",
        2,
        [
            new IntakeColumnMapping(1, "Nombre completo", IntakeTargetFields.Name, null, "high", null),
            new IntakeColumnMapping(2, "Correo", IntakeTargetFields.Email, null, "high", null),
            new IntakeColumnMapping(3, "Puesto", IntakeTargetFields.Role, null, "high", null),
            new IntakeColumnMapping(4, "Área", IntakeTargetFields.Department, null, "high", null),
            new IntakeColumnMapping(5, "Sede", IntakeTargetFields.Demographic, "sede", "high", null),
            new IntakeColumnMapping(6, "Años", IntakeTargetFields.Demographic, "antiguedad", "medium", null),
            new IntakeColumnMapping(7, "Ingreso", IntakeTargetFields.Demographic, "ingreso", "medium", null),
        ],
        "last_first",
        Roles.Employee,
        [
            new IntakeValueMapping("Gerente de Finanzas", Roles.Leader, "high", null),
            new IntakeValueMapping("analista", Roles.Employee, "high", null),
            new IntakeValueMapping("Supervisora de Turno", Roles.Supervisor, "high", null),
        ],
        [
            new IntakeDepartmentMapping("Finanzas", "Finanzas", false, "high", null),
            new IntakeDepartmentMapping("RRHH", "Personas", false, "high", null),
            new IntakeDepartmentMapping("Calidad", "Calidad", true, "medium", null),
        ],
        [
            new IntakeDemographicValueMapping("sede", "San José", "san_jose", "high"),
            new IntakeDemographicValueMapping("sede", "Heredia", "heredia", "high"),
        ],
        "Resumen");

    private static IntakeApplyResult Apply() => IntakeMappingApplier.Apply(Grid(Roster), Mapping(), Targets);

    [Fact]
    public void Surnames_first_names_are_reordered_and_shouting_names_recased()
    {
        var rows = Apply().Rows;

        Assert.Equal("Ana María Rojas Pérez", rows[0].Name);
        Assert.Equal("Carlos Jiménez Mora", rows[1].Name);
        Assert.Equal(1, Apply().NamesNormalised);
    }

    [Fact]
    public void Emails_are_trimmed_and_lower_cased_and_blank_rows_skipped_with_file_row_numbers_kept()
    {
        var rows = Apply().Rows;

        Assert.Equal([3, 4, 6, 7], rows.Select(r => r.RowNumber));
        Assert.Equal("ana.rojas@meridiano.cr", rows[0].Email);
    }

    [Fact]
    public void Job_titles_map_to_roles_case_insensitively_and_an_unmapped_title_passes_through_for_the_verdict()
    {
        var rows = Apply().Rows;

        Assert.Equal(Roles.Leader, rows[0].Role);
        Assert.Equal(Roles.Employee, rows[1].Role);   // "Analista" matched "analista"
        Assert.Equal(Roles.Supervisor, rows[2].Role);
        Assert.Equal("Pasante", rows[3].Role);        // no answer: the verdict names it, nothing guesses
    }

    [Fact]
    public void Areas_map_to_existing_departments_and_an_approved_new_one_is_proposed_once()
    {
        var result = Apply();

        Assert.Equal("Finanzas", result.Rows[1].Department); // "finanzas" → canonical spelling
        Assert.Equal("Personas", result.Rows[2].Department); // "RRHH" → Personas
        Assert.Equal("Calidad", result.Rows[3].Department);
        Assert.Equal(["Calidad"], result.NewDepartments);
    }

    [Fact]
    public void Demographics_map_select_values_and_normalise_numbers_and_dates()
    {
        var rows = Apply().Rows;

        Assert.Equal("san_jose", rows[0].Demographics!["sede"]);
        Assert.Equal("12", rows[0].Demographics!["antiguedad"]);
        Assert.Equal("2014-03-15", rows[0].Demographics!["ingreso"]);
        Assert.Equal("3", rows[1].Demographics!["antiguedad"]);         // "3,0"
        Assert.Equal("Cartago", rows[3].Demographics!["sede"]);          // no option: passes through for validation
        Assert.False(rows[2].Demographics!.ContainsKey("antiguedad"));    // blank cell: no answer, not ""
    }

    [Fact]
    public void Without_a_role_column_every_row_takes_the_default_role()
    {
        var mapping = Mapping() with
        {
            Columns = Mapping().Columns.Select(c => c.Target == IntakeTargetFields.Role ? c with { Target = IntakeTargetFields.Ignore } : c).ToList(),
        };

        var rows = IntakeMappingApplier.Apply(Grid(Roster), mapping, Targets).Rows;

        Assert.All(rows, r => Assert.Equal(Roles.Employee, r.Role));
    }

    [Fact]
    public void A_totals_footer_is_skipped_and_reported_not_imported_as_a_person()
    {
        var withFooter = Roster.Append(["", "", "", "Total colaboradores:", "", "22", ""]).ToArray();
        withFooter[^1][0] = "22";

        var result = IntakeMappingApplier.Apply(Grid(withFooter), Mapping(), Targets);

        Assert.Equal(4, result.Rows.Count);
        Assert.Equal([withFooter.Length], result.SkippedRows);
    }

    [Fact]
    public void Split_name_columns_are_joined()
    {
        string[][] rows = [["Nombre", "Apellidos", "Correo"], ["Ana", "Rojas Pérez", "ana@x.cr"]];
        var mapping = new IntakeMapping("S", 1,
        [
            new IntakeColumnMapping(1, "Nombre", IntakeTargetFields.FirstName, null, "high", null),
            new IntakeColumnMapping(2, "Apellidos", IntakeTargetFields.LastName, null, "high", null),
            new IntakeColumnMapping(3, "Correo", IntakeTargetFields.Email, null, "high", null),
        ], "first_last", Roles.Employee, [], [], [], null);

        var row = Assert.Single(IntakeMappingApplier.Apply(Grid(rows, "S"), mapping, Targets).Rows);

        Assert.Equal("Ana Rojas Pérez", row.Name);
    }

    [Fact]
    public void A_mapping_with_no_email_column_is_reported_as_a_problem_not_a_crash()
    {
        var mapping = Mapping() with
        {
            Columns = Mapping().Columns.Where(c => c.Target != IntakeTargetFields.Email).ToList(),
        };

        var result = IntakeMappingApplier.Apply(Grid(Roster), mapping, Targets);

        Assert.Contains(result.Problems, p => p.Code == "no_email_column");
        Assert.Equal(4, result.Rows.Count);
    }

    // ---------------------------------------------------------------- sanitizer

    [Fact]
    public void The_sanitizer_never_lets_a_model_assign_an_admin_role()
    {
        var raw = Mapping() with
        {
            RoleValues = [new IntakeValueMapping("Gerente General", Roles.CompanyAdmin, "high", null), new IntakeValueMapping("CEO", Roles.SuperAdmin, "high", null)],
            DefaultRole = Roles.CompanyAdmin,
        };

        var clean = IntakeMappingSanitizer.Sanitize(raw, [Grid(Roster)], Targets);

        Assert.Empty(clean.RoleValues);
        Assert.Equal(Roles.Employee, clean.DefaultRole);
    }

    [Fact]
    public void The_sanitizer_drops_references_to_things_that_do_not_exist()
    {
        var raw = Mapping() with
        {
            Sheet = "No such sheet",
            HeaderRow = 999,
            Columns =
            [
                new IntakeColumnMapping(2, "Correo", IntakeTargetFields.Email, null, "high", null),
                new IntakeColumnMapping(3, "Puesto", "salary", null, "certain", null),
                new IntakeColumnMapping(4, "Área", IntakeTargetFields.Email, null, "high", null),  // a second email column
                new IntakeColumnMapping(5, "Sede", IntakeTargetFields.Demographic, "not_a_field", "high", null),
                new IntakeColumnMapping(42, "Ghost", IntakeTargetFields.Name, null, "high", null),
            ],
            DepartmentValues =
            [
                new IntakeDepartmentMapping("Ventas", "Ventas", false, "high", null),        // claims to exist; does not
                new IntakeDepartmentMapping("personas", "PERSONAS", false, "high", null),    // exists, in other case
            ],
            DemographicValues = [new IntakeDemographicValueMapping("sede", "Cartago", "cartago", "high")],
        };

        var clean = IntakeMappingSanitizer.Sanitize(raw, [Grid(Roster)], Targets);

        Assert.Equal("Personal", clean.Sheet);
        Assert.Equal(2, clean.HeaderRow);
        Assert.Equal(7, clean.Columns.Count);                       // every real column, once, ghost gone
        Assert.Equal(IntakeTargetFields.Ignore, clean.Columns.Single(c => c.Column == 3).Target);
        Assert.Equal("low", clean.Columns.Single(c => c.Column == 3).Confidence);
        Assert.Equal(IntakeTargetFields.Ignore, clean.Columns.Single(c => c.Column == 4).Target);
        Assert.Equal(IntakeTargetFields.Ignore, clean.Columns.Single(c => c.Column == 5).Target);
        Assert.Null(clean.DepartmentValues[0].Department);
        Assert.Equal("Personas", clean.DepartmentValues[1].Department);
        Assert.Null(clean.DemographicValues.Single().Target);
    }

    // ---------------------------------------------------------------- insights

    [Fact]
    public void Insights_find_domain_typos_outside_domains_duplicates_and_gaps()
    {
        ParsedImportRow Row(int n, string email, string? department = "Finanzas", string name = "X") =>
            new(n, name, email, Roles.Employee, department);
        var rows = new[]
        {
            Row(3, "a@meridiano.cr"),
            Row(4, "b@gmial.com"),
            Row(5, "c@meridano.cr"),        // one letter off the company's own domain
            Row(6, "d@gmail.com"),
            Row(7, "a@meridiano.cr"),       // duplicate of row 3
            Row(8, "not-an-email"),
            Row(9, "", department: null),
            Row(10, "e@meridiano.cr", name: ""),
        };

        var insights = IntakeInsights.Compute(rows, "meridiano.cr", ["Calidad"]);

        Assert.Contains(insights, i => i is { Code: "email_typo", Value: "gmial.com", Suggestion: "gmail.com" } && i.Rows.SequenceEqual([4]));
        Assert.Contains(insights, i => i is { Code: "email_typo", Value: "meridano.cr", Suggestion: "meridiano.cr" } && i.Rows.SequenceEqual([5]));
        Assert.Contains(insights, i => i is { Code: "outside_domain", Value: "gmail.com" } && i.Rows.SequenceEqual([6]));
        Assert.Contains(insights, i => i.Code == "duplicate_in_file" && i.Rows.SequenceEqual([7]));
        Assert.Contains(insights, i => i.Code == "invalid_email" && i.Rows.SequenceEqual([8]));
        Assert.Contains(insights, i => i.Code == "missing_email" && i.Rows.SequenceEqual([9]));
        Assert.Contains(insights, i => i.Code == "no_department" && i.Rows.SequenceEqual([9]));
        Assert.Contains(insights, i => i.Code == "missing_name" && i.Rows.SequenceEqual([10]));
        Assert.Contains(insights, i => i is { Code: "new_department", Value: "Calidad" });
    }

    // ---------------------------------------------------------------- heuristic / template

    [Fact]
    public void Our_own_template_is_recognised_and_needs_no_model()
    {
        string[][] template =
        [
            ["Personas de Grupo Meridiano S.A."], [""], ["Una fila por persona"],
            ["Nombre", "Correo", "Rol", "Departamento"],
            ["Ana Rojas", "ana@x.cr", "Colaborador", "Finanzas"],
        ];
        var sheet = Grid(template, IntakeWorkbook.PeopleSheet);

        Assert.True(IntakeHeuristicMapping.IsTemplate(sheet));
        var row = Assert.Single(IntakeMappingApplier.Apply(sheet, IntakeHeuristicMapping.Build(sheet, Targets), Targets).Rows);
        Assert.Equal(("Ana Rojas", "ana@x.cr", Roles.Employee, "Finanzas"), (row.Name, row.Email, row.Role, row.Department));
    }

    /// <summary>
    /// Without the model, a job title, an area and a site still get a best guess the admin can
    /// correct — instead of every row arriving at review unmapped and red.
    /// </summary>
    [Fact]
    public void The_fallback_guesses_roles_departments_and_options_from_the_values()
    {
        string[][] rows =
        [
            ["Nombre", "Correo", "Puesto", "Departamento / Área", "Sede"],
            ["A", "a@x.cr", "Gerente Financiera", "Finanzas y Contabilidad", "San José Centro"],
            ["B", "b@x.cr", "Jefe de Turno", "RRHH", "Heredia - Zona Franca"],
            ["C", "c@x.cr", "Analista", "Logística", "Limón"],
        ];
        var targets = Targets with
        {
            Demographics = [new IntakeDemographicTarget("sede", "Sede", "select", ["san_jose", "heredia"], new Dictionary<string, string> { ["san_jose"] = "San José", ["heredia"] = "Heredia" })],
        };

        var mapping = IntakeHeuristicMapping.Build(Grid(rows), targets);

        Assert.Equal(Roles.Leader, mapping.RoleValues.Single(v => v.Source == "Gerente Financiera").Target);
        Assert.Equal(Roles.Supervisor, mapping.RoleValues.Single(v => v.Source == "Jefe de Turno").Target);
        Assert.Equal(Roles.Employee, mapping.RoleValues.Single(v => v.Source == "Analista").Target);
        Assert.Equal("Finanzas", mapping.DepartmentValues.Single(v => v.Source == "Finanzas y Contabilidad").Department);
        Assert.Equal("Personas", mapping.DepartmentValues.Single(v => v.Source == "RRHH").Department);
        Assert.True(mapping.DepartmentValues.Single(v => v.Source == "Logística").CreateNew);
        Assert.Equal("san_jose", mapping.DemographicValues.Single(v => v.Source == "San José Centro").Target);
        Assert.Equal("heredia", mapping.DemographicValues.Single(v => v.Source == "Heredia - Zona Franca").Target);
        Assert.Null(mapping.DemographicValues.Single(v => v.Source == "Limón").Target);
    }

    [Fact]
    public void Header_words_alone_give_a_usable_fallback_mapping()
    {
        string[][] rows = [["Nombre", "Apellidos", "E-mail", "Puesto actual", "Departamento / Área", "Sede", "Teléfono"], ["Ana", "Rojas", "a@x.cr", "Analista", "Finanzas", "Heredia", "8888-8888"]];

        var mapping = IntakeHeuristicMapping.Build(Grid(rows), Targets);

        string Target(int column) => mapping.Columns.Single(c => c.Column == column).Target;
        Assert.Equal(IntakeTargetFields.FirstName, Target(1));
        Assert.Equal(IntakeTargetFields.LastName, Target(2));
        Assert.Equal(IntakeTargetFields.Email, Target(3));
        Assert.Equal(IntakeTargetFields.Role, Target(4));
        Assert.Equal(IntakeTargetFields.Department, Target(5));
        Assert.Equal("sede", mapping.Columns.Single(c => c.Column == 6).DemographicField);
        Assert.Equal(IntakeTargetFields.Ignore, Target(7));
    }
}
