using System.Globalization;
using System.IO.Compression;
using System.Net.Mail;
using System.Text;
using System.Text.RegularExpressions;
using ClimateProject.Application.Auth;
using ClimateProject.Application.Localization;
using ClimateProject.Application.OrgStructure;
using ClosedXML.Excel;

namespace ClimateProject.Application.Surveys;

public sealed record ClimateWorkbookCompany(string Name, string EmailDomain, string Industry, string Size,
    string Country, string Language, string Timezone, bool Anonymous, UpdateResultBandsRequest ResultBands);
public sealed record ClimateWorkbookField(string Field, string Label, IReadOnlyList<string> Options);
public sealed record ClimateWorkbookContent(ClimateWorkbookCompany Company, string Title, string Description,
    DateTimeOffset StartDate, DateTimeOffset EndDate, string? InvitationSubject, string? InvitationMessage,
    IReadOnlyList<CreateSurveyQuestionInput> Questions, IReadOnlyList<ClimateWorkbookField> Fields,
    IReadOnlyList<ParsedImportRow> People);
public sealed record ClimateWorkbookReadResult(ClimateWorkbookContent? Content, IReadOnlyList<string> Errors);

/// <summary>Reads the published TIMS/NEXA workbook without AI, external calls or database writes.</summary>
public static partial class ClimateWorkbook
{
    public const int MaxPeople = 1000;
    public const int MaxQuestions = 200;
    public const long MaxExpandedBytes = 64 * 1024 * 1024;

    public static ClimateWorkbookReadResult Read(Stream stream, DateTimeOffset now)
    {
        var errors = new List<string>();
        // Images and formatting may make a template large; compressed XML must still be bounded.
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true))
        {
            if (zip.Entries.Count > 2000 || zip.Entries.Any(e=>e.Length>MaxExpandedBytes) || zip.Entries.Sum(e => e.Length) > MaxExpandedBytes)
                return new(null, ["El archivo excede el tamaño permitido al descomprimirse."]);
        }
        stream.Position = 0;
        using var book = new XLWorkbook(stream);
        foreach (var sheetName in new[] { "EMPRESA", "DESCRIPCION", "ESCALAS", "PREGUNTAS", "DEMOGRAFICOS" })
            if (!book.Worksheets.Contains(sheetName)) errors.Add($"Falta la hoja {sheetName}.");
        if (errors.Count > 0) return new(null, errors);
        string Cell(IXLWorksheet sheet, int row, int col)
        {
            var cell = sheet.Cell(row, col);
            if (cell.HasFormula) { errors.Add($"{sheet.Name} {cell.Address}: use un valor, no una fórmula."); return ""; }
            return cell.GetFormattedString(CultureInfo.InvariantCulture).Trim();
        }
        var companySheet = book.Worksheet("EMPRESA");
        var companyFields = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var r = 5; r <= 25; r++)
        {
            var label = Key(Cell(companySheet, r, 1));
            if (label.Length > 0) companyFields.TryAdd(label, r);
        }
        string Setting(string label) => companyFields.TryGetValue(Key(label), out var r) ? Cell(companySheet, r, 2) : "";
        string Required(string label)
        {
            var value = Setting(label);
            if (value.Length == 0) errors.Add($"EMPRESA: complete {label}.");
            return value;
        }
        var name = Required("Nombre legal / comercial");
        var domain = Required("Dominio de correo").ToLowerInvariant();
        if (!CompanyValidation.IsValidDomain(domain)) errors.Add("EMPRESA: el dominio de correo no es válido.");
        var industry = Required("Sector");
        var country = Required("País principal");
        var title = Required("Nombre del clima");
        if (name.Length > 200 || title.Length > 200 || industry.Length > 100 || country.Length > 100)
            errors.Add("EMPRESA: nombre y título admiten 200 caracteres; sector y país, 100.");
        var language = Key(Required("Idioma")) switch { "espanol" or "es" => "es", "ingles" or "en" => "en", _ => "" };
        if (language.Length == 0) errors.Add("EMPRESA: Idioma debe ser Español o Inglés.");
        var anonymousText = Key(Required("Anonimato"));
        if (anonymousText is not ("anonima" or "identificada")) errors.Add("EMPRESA: Anonimato debe ser Anónima o Identificada.");
        if(Setting("Servicio / licencia").Length>0)errors.Add("EMPRESA: deje Servicio / licencia vacío; la licencia se asigna desde la encuesta antes de publicar.");
        var timezone = Required("Zona horaria");
        TimeZoneInfo? zone = null;
        try { zone = TimeZoneInfo.FindSystemTimeZoneById(timezone); }
        catch (TimeZoneNotFoundException) { errors.Add("EMPRESA: use una zona horaria válida, por ejemplo America/Costa_Rica."); }
        catch (InvalidTimeZoneException) { errors.Add("EMPRESA: la zona horaria no es válida."); }
        DateTimeOffset Date(string label)
        {
            var raw = Required(label);
            if (!companyFields.TryGetValue(Key(label), out var r)) return default;
            var cell = companySheet.Cell(r, 2);
            DateTime local;
            if (cell.DataType == XLDataType.DateTime) local = cell.GetDateTime();
            else if (!DateTime.TryParseExact(raw, ["yyyy-MM-dd", "yyyy-MM-dd HH:mm", "yyyy-MM-ddTHH:mm", "dd/MM/yyyy", "dd/MM/yyyy HH:mm"], CultureInfo.InvariantCulture, DateTimeStyles.None, out local))
            { errors.Add($"EMPRESA: {label} debe ser una fecha Excel o AAAA-MM-DD HH:mm."); return default; }
            local = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
            if (zone is null) return default;
            if (zone.IsInvalidTime(local) || zone.IsAmbiguousTime(local))
            { errors.Add($"EMPRESA: {label} coincide con un cambio de horario; elija otra hora."); return default; }
            return new DateTimeOffset(local, zone.GetUtcOffset(local));
        }
        var start = Date("Fecha de apertura"); var end = Date("Fecha de cierre");
        if (start >= end || end <= now) errors.Add("EMPRESA: el cierre debe ser posterior a la apertura y estar en el futuro.");
        var size = Key(Setting("Tamaño de empresa")) switch
        {
            "emergente" or "startup" => "startup", "pequena" or "small" => "small", "mediana" or "medium" => "medium",
            "grande" or "large" => "large", "corporativa" or "enterprise" => "enterprise", _ => ""
        };
        // Older copies did not have a size control. Classify them after reading the roster.
        var resultScale = Key(Setting("Escala de resultados")) switch
        { "" or "1 a 5" or "mean" => "mean", "0 a 100" or "percent" or "0 100" => "percent", _ => "" };
        if (resultScale.Length == 0) errors.Add("EMPRESA: Escala de resultados debe ser 1 a 5 o 0 a 100.");
        var desc = book.Worksheet("DESCRIPCION");
        var description = Cell(desc, 6, 2).Replace("[Empresa]", name, StringComparison.Ordinal);
        if (description.Length == 0) errors.Add("DESCRIPCION B6: complete la descripción.");
        var invitation = Cell(desc, 10, 2).Replace("[Empresa]", name, StringComparison.Ordinal);
        var lines = invitation.Split('\n');
        var subjectAt = Array.FindIndex(lines, l => l.TrimStart().StartsWith("Asunto:", StringComparison.OrdinalIgnoreCase));
        var subject = subjectAt < 0 ? null : lines[subjectAt].Split(':', 2)[1].Trim();
        var message = subjectAt < 0 ? invitation : string.Join('\n', lines.Skip(subjectAt + 1)).Trim();

        if(subject?.Length>200 || message.Length>10000 || description.Length>10000)errors.Add("DESCRIPCION: asunto máximo 200 caracteres; textos, 10000.");

        var scaleSheet = book.Worksheet("ESCALAS");
        int FindScale(string label) => Enumerable.Range(1, Math.Min(100, scaleSheet.LastRowUsed()?.RowNumber() ?? 1))
            .FirstOrDefault(r => Key(Cell(scaleSheet, r, 2)) == Key(label));
        var answerAt = FindScale("Escala de respuestas");
        var labels = new List<string>();
        if (answerAt == 0) errors.Add("ESCALAS: falta Escala de respuestas.");
        else for (var r = answerAt + 2; r <= answerAt + 7 && Cell(scaleSheet, r, 2).Length > 0; r++)
        {
            labels.Add(Cell(scaleSheet, r, 2));
            if (!int.TryParse(Cell(scaleSheet, r, 3), out var v) || v != labels.Count)
                errors.Add($"ESCALAS fila {r}: los valores de respuesta deben ser 1, 2, 3, 4 y 5.");
        }
        if (labels.Count != 5) errors.Add("ESCALAS: se requieren cinco respuestas, de 1 a 5. El puntaje 0 a 100 se elige en EMPRESA.");
        var bandAt = FindScale("Escala de calificaciones");
        var bands = new List<(string Name, decimal Min, decimal Max)>();
        if (bandAt == 0) errors.Add("ESCALAS: falta Escala de calificaciones.");
        else for (var r = bandAt + 2; r <= bandAt + 5 && Cell(scaleSheet, r, 2).Length > 0; r++)
        {
            if (decimal.TryParse(Cell(scaleSheet, r, 3), NumberStyles.Number, CultureInfo.InvariantCulture, out var min)
                && decimal.TryParse(Cell(scaleSheet, r, 4), NumberStyles.Number, CultureInfo.InvariantCulture, out var max))
                bands.Add((Cell(scaleSheet, r, 2), min, max));
            else errors.Add($"ESCALAS fila {r}: los límites deben ser números.");
        }
        bands.Sort((a,b) => a.Min.CompareTo(b.Min));
        var bandRequest = new UpdateResultBandsRequest(3,4,null,null,null,resultScale);
        if (bands.Count != 3 || bands[0].Min != 1 || bands[2].Max != 5
            || bands[0].Max != bands[1].Min - .01m || bands[1].Max != bands[2].Min - .01m)
            errors.Add("ESCALAS: las tres áreas deben cubrir de 1 a 5, sin huecos ni solapes, con dos decimales.");
        else
        {
            bandRequest = new(bands[1].Min,bands[2].Min,bands[0].Name,bands[1].Name,bands[2].Name,resultScale);
            if (ResultBandsValidation.Validate(bandRequest) is not null) errors.Add("ESCALAS: revise límites y nombres de las áreas.");
        }

        var questionsSheet = book.Worksheet("PREGUNTAS");
        if((questionsSheet.LastRowUsed(XLCellsUsedOptions.Contents)?.RowNumber()??0)>600) errors.Add("PREGUNTAS: hay contenido después de la fila 600.");
        var questions = new List<CreateSurveyQuestionInput>();
        string? dimension = null; var dimensionQuestions = 0;
        for (var r = 6; r <= Math.Min(600, questionsSheet.LastRowUsed()?.RowNumber() ?? 1); r++)
        {
            var text = Cell(questionsSheet, r, 2).Replace("[Empresa]", name, StringComparison.Ordinal);
            if (text.Length == 0) continue;
            if(text.Length>4000) errors.Add($"PREGUNTAS fila {r}: máximo 4000 caracteres.");
            // Numbered rows are questions. Punctuation supports legacy copies;
            // unnumbered rows without terminal punctuation are dimension headings.
            var statement = int.TryParse(Cell(questionsSheet,r,1),out _) || text.EndsWith('.') || text.EndsWith('?') || text.EndsWith('!');
            if (!statement)
            {
                if (dimension is not null && dimensionQuestions == 0) errors.Add($"PREGUNTAS: {dimension} no contiene preguntas.");
                dimension = text; dimensionQuestions = 0; continue;
            }
            if (dimension is null) { errors.Add($"PREGUNTAS fila {r}: falta el título de dimensión."); continue; }
            var open = Key(dimension) == "preguntas abiertas";
            questions.Add(new CreateSurveyQuestionInput(Local(text, language), open ? "open_ended" : "likert",
                Options: open ? null : labels.Select((label,i) => new CreateSurveyQuestionOptionInput((i+1).ToString(CultureInfo.InvariantCulture), Local(label,language))).ToList(),
                ScaleMin: open ? null : 1, ScaleMax: open ? null : 5,
                ScaleLabelMin: open || labels.Count == 0 ? null : Local(labels[0],language),
                ScaleLabelMax: open || labels.Count == 0 ? null : Local(labels[^1],language),
                Required: !open, CommentRequired: false, Order: questions.Count + 1, Category: dimension));
            dimensionQuestions++;
        }
        if (dimension is not null && dimensionQuestions == 0) errors.Add($"PREGUNTAS: {dimension} no contiene preguntas.");
        if (questions.Count is < 1 or > MaxQuestions) errors.Add($"PREGUNTAS: se admiten entre 1 y {MaxQuestions} preguntas.");

        var peopleSheet = book.Worksheet("DEMOGRAFICOS");
        if((peopleSheet.LastRowUsed(XLCellsUsedOptions.Contents)?.RowNumber()??5)>MaxPeople+5)
            errors.Add($"DEMOGRAFICOS: hay datos después de la fila {MaxPeople+5}; se admiten hasta {MaxPeople} personas.");
        if((peopleSheet.LastColumnUsed(XLCellsUsedOptions.Contents)?.ColumnNumber()??0)>30) errors.Add("DEMOGRAFICOS: se admiten columnas hasta AD.");
        var columns = Enumerable.Range(2,29).Select(c => (Column:c,Label:Cell(peopleSheet,5,c))).Where(c=>c.Label.Length>0).ToList();
        if(columns.Select(c=>Key(c.Label)).Distinct().Count()!=columns.Count) return new(null,[..errors,"DEMOGRAFICOS: hay encabezados duplicados en la fila 5."]);
        int Column(params string[] keys) => columns.FirstOrDefault(c=>keys.Contains(Key(c.Label),StringComparer.Ordinal)).Column;
        var emailCol=Column("correo","correo electronico","email","e mail"); var departmentCol=Column("area departamento","departamento","area","department");
        var nameCol=Column("nombre","nombre completo");var surnameCol=Column("apellido","apellidos");var roleCol=Column("rol","role");var jobCol=Column("puesto","cargo");
        if (emailCol==0 || departmentCol==0 || nameCol==0) errors.Add("DEMOGRAFICOS fila 5: se requieren Nombre, Correo y Área / Departamento.");
        var reserved=new[]{emailCol,departmentCol,nameCol,surnameCol,roleCol};
        var demographicCols=columns.Where(c=>!reserved.Contains(c.Column)).ToList();
        if (demographicCols.Any(c=>Slug(c.Label).Length==0)||demographicCols.Select(c=>Slug(c.Label)).Distinct().Count()!=demographicCols.Count) return new(null,[..errors,"DEMOGRAFICOS: hay encabezados demográficos inválidos o duplicados."]);
        var rawPeople=new List<(ParsedImportRow Person,Dictionary<string,string> Raw)>();
        var emails=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (emailCol>0 && departmentCol>0 && nameCol>0)
        for(var r=6;r<=Math.Min(peopleSheet.LastRowUsed()?.RowNumber()??5,MaxPeople+6);r++)
        {
            string Value(int c)=>c==0?"":Cell(peopleSheet,r,c);
            var email=Value(emailCol).ToLowerInvariant();var full=string.Join(' ',new[]{Value(nameCol),Value(surnameCol)}.Where(v=>v.Length>0));var department=Value(departmentCol);
            if(email.Length==0 && full.Length==0 && department.Length==0)continue;
            if(rawPeople.Count>=MaxPeople){errors.Add($"DEMOGRAFICOS: se admiten hasta {MaxPeople} personas.");break;}
            if(!MailAddress.TryCreate(email,out var address)||address.Address!=email||!email.Contains('.'))errors.Add($"DEMOGRAFICOS fila {r}: correo inválido.");
            if(!emails.Add(email))errors.Add($"DEMOGRAFICOS fila {r}: correo duplicado en el archivo.");
            if(full.Length is 0 or > 200 || department.Length is 0 or > 100)errors.Add($"DEMOGRAFICOS fila {r}: nombre y departamento son obligatorios (máximos 200 y 100 caracteres).");
            var explicitRole=Value(roleCol);
            var role=IntakeWorkbook.ResolveRole(explicitRole);
            if(explicitRole.Length>0 && role is null)errors.Add($"DEMOGRAFICOS fila {r}: Rol debe ser Colaborador, Líder o Supervisor.");
            role??=JobLeader().IsMatch(Key(Value(jobCol)))?Roles.Leader:Roles.Employee;
            var raw=demographicCols.ToDictionary(c=>Slug(c.Label),c=>Value(c.Column));
            if(raw.Any(kv=>kv.Value.Length>200))errors.Add($"DEMOGRAFICOS fila {r}: un valor demográfico excede 200 caracteres.");
            rawPeople.Add((new ParsedImportRow(r,full,email,role,department),raw));
        }
        if(rawPeople.Count==0)errors.Add("DEMOGRAFICOS: agregue al menos una persona.");
        var fields=demographicCols.Select(c=>new ClimateWorkbookField(Slug(c.Label),c.Label,
            rawPeople.Select(p=>p.Raw[Slug(c.Label)]).Where(v=>v.Length>0).Distinct(StringComparer.OrdinalIgnoreCase).ToArray())).ToList();
        if(fields.Any(f=>f.Options.Any(v=>Slug(v).Length==0)||f.Options.Select(Slug).Distinct().Count()!=f.Options.Count))errors.Add("DEMOGRAFICOS: dos opciones generan la misma clave; unifique su escritura.");
        var people=rawPeople.Select(p=>p.Person with {Demographics=p.Raw.Where(kv=>kv.Value.Length>0).ToDictionary(kv=>kv.Key,kv=>(string?)Slug(kv.Value))}).ToList();
        if(size.Length==0)size=people.Count<=10?"startup":people.Count<=50?"small":people.Count<=250?"medium":people.Count<=1000?"large":"enterprise";
        var company=new ClimateWorkbookCompany(name,domain,industry,size,country,language,timezone,anonymousText=="anonima",bandRequest);
        return new(new(company,title,description,start,end,subject,message,questions,fields,people),errors.Distinct().ToArray());
    }

    public static LocalizedInput Local(string text,string language)=>LocalizedInput.FromLocales(new Dictionary<string,string?>{{language=="en"?"en":"es",text}});
    public static string Key(string text)=>Regex.Replace(string.Concat(text.Normalize(NormalizationForm.FormD).Where(c=>CharUnicodeInfo.GetUnicodeCategory(c)!=UnicodeCategory.NonSpacingMark)).ToLowerInvariant(),"[^a-z0-9]+"," ").Trim();
    public static string Slug(string text)=>Key(text).Replace(' ','_')[..Math.Min(60,Key(text).Length)];
    [GeneratedRegex(@"\b(director|directora|gerente|presidente|presidenta|jefe|jefa)\b")]
    private static partial Regex JobLeader();
}
