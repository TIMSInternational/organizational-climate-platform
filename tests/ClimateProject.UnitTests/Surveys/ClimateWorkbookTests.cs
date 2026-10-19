using ClimateProject.Application.Surveys;
using ClosedXML.Excel;

namespace ClimateProject.UnitTests.Surveys;

public class ClimateWorkbookTests
{
    public static XLWorkbook Filled(int count=1)
    {
        var book=new XLWorkbook();
        var company=book.AddWorksheet("EMPRESA");
        string[][] settings=[
            ["Nombre legal / comercial","Empresa prueba"],["Dominio de correo","empresa.test"],
            ["Sector","Servicios"],["País principal","Costa Rica"],["Nombre del clima","Clima de prueba"],
            ["Idioma","Español"],["Anonimato","Anónima"],["Zona horaria","America/Costa_Rica"],
            ["Fecha de apertura","2026-10-15 10:00"],["Fecha de cierre","2026-11-15 18:00"],
            ["Escala de resultados","0 a 100"]];
        for(var i=0;i<settings.Length;i++){company.Cell(i+5,1).Value=settings[i][0];company.Cell(i+5,2).Value=settings[i][1];}
        var description=book.AddWorksheet("DESCRIPCION");description.Cell("B6").Value="Descripción de [Empresa].";description.Cell("B10").Value="Asunto: Clima [Empresa]\nParticipe.";
        var scale=book.AddWorksheet("ESCALAS");scale.Cell("B6").Value="Escala de calificaciones";
        string[] bands=["Crítica","Oportunidad","Fortaleza"];
        decimal[] min=[1,3,4],max=[2.99m,3.99m,5];
        for(var i=0;i<3;i++){scale.Cell(i+8,2).Value=bands[i];scale.Cell(i+8,3).Value=min[i];scale.Cell(i+8,4).Value=max[i];}
        scale.Cell("B13").Value="Escala de respuestas";
        for(var i=0;i<5;i++){scale.Cell(i+15,2).Value=$"Respuesta {i+1}";scale.Cell(i+15,3).Value=i+1;}
        var questions=book.AddWorksheet("PREGUNTAS");questions.Cell("B6").Value="Comunicación";questions.Cell("A7").Value=1;questions.Cell("B7").Value="Me informan en [Empresa]";
        questions.Cell("B9").Value="Preguntas abiertas";questions.Cell("A10").Value=2;questions.Cell("B10").Value="¿Qué mejoraría?";
        var people=book.AddWorksheet("DEMOGRAFICOS");string[] headers=["Nombre","Apellido","Correo","Puesto","Región","Área / Departamento","Rol"];
        for(var i=0;i<headers.Length;i++)people.Cell(5,i+2).Value=headers[i];
        for(var i=0;i<count;i++){
            var r=i+6;people.Cell(r,2).Value=$"Persona {i+1}";people.Cell(r,3).Value="Prueba";people.Cell(r,4).Value=$"persona{i+1}@example.test";
            people.Cell(r,5).Value="Analista";people.Cell(r,6).Value=i%2==0?"Norte":"Sur";people.Cell(r,7).Value="Operaciones";people.Cell(r,8).Value="Colaborador";
        }
        return book;
    }
    public static ClimateWorkbookReadResult Read(XLWorkbook book)
    {
        using var stream=new MemoryStream();book.SaveAs(stream);stream.Position=0;
        return ClimateWorkbook.Read(stream,DateTimeOffset.Parse("2026-10-15T00:00:00Z"));
    }
    [Fact] public void Reads_800_people_questions_demographics_and_percent_display_together()
    {
        using var book=Filled(800);var result=Read(book);Assert.Empty(result.Errors);
        var content=Assert.IsType<ClimateWorkbookContent>(result.Content);Assert.Equal(800,content.People.Count);
        Assert.Equal(800,content.People.Select(p=>p.Email).Distinct().Count());Assert.Equal(2,content.Questions.Count);
        Assert.Contains("Empresa prueba",content.Questions[0].Text!.ByLocale!["es"]);
        Assert.Equal("likert",content.Questions[0].Type);Assert.Equal(5,content.Questions[0].Options!.Count);
        Assert.Equal("open_ended",content.Questions[1].Type);
        // Required, as every question in a climate workbook now is. Ruled 2026-10-18 on ESPH's
        // finding 8 -- "La pregunta 63 abierta sale como opcional". This asserted False until then,
        // and `scripts/import-climate-workbook.mjs` asserts the same thing for the same workbook.
        Assert.True(content.Questions[1].Required);
        Assert.Equal("percent",content.Company.ResultBands.Scale);Assert.Equal("large",content.Company.Size);
        Assert.Contains(content.Fields,f=>f.Field=="puesto");Assert.Equal("norte",content.People[0].Demographics!["region"]);
    }
    [Fact] public void Duplicate_emails_across_batches_are_refused_before_any_writes()
    {
        using var book=Filled(101);book.Worksheet("DEMOGRAFICOS").Cell("D106").Value="PERSONA1@example.test";
        Assert.Contains(Read(book).Errors,e=>e.Contains("duplicado"));
    }
    [Fact] public void Formulas_invalid_roles_and_noncontiguous_bands_are_refused()
    {
        using var book=Filled();book.Worksheet("DEMOGRAFICOS").Cell("B6").FormulaA1="1+1";
        book.Worksheet("DEMOGRAFICOS").Cell("H6").Value="Super administrador";
        book.Worksheet("ESCALAS").Cell("D8").Value=2.8;
        var errors=Read(book).Errors;Assert.Contains(errors,e=>e.Contains("fórmula"));Assert.Contains(errors,e=>e.Contains("Rol debe"));Assert.Contains(errors,e=>e.Contains("sin huecos"));
    }
    [Fact] public void Refuses_data_after_1000_and_expired_dates()
    {
        using var book=Filled(1001);book.Worksheet("EMPRESA").Cell("B14").Value="2026-10-01";
        var errors=Read(book).Errors;Assert.Contains(errors,e=>e.Contains("1000"));Assert.Contains(errors,e=>e.Contains("futuro"));
    }
    [Fact] public void Explicit_role_overrides_job_and_missing_required_sheets_are_clear()
    {
        using var book=Filled();book.Worksheet("DEMOGRAFICOS").Cell("E6").Value="Gerente";
        Assert.Equal("employee",Read(book).Content!.People[0].Role);
        using var missing=Filled();missing.Worksheet("PREGUNTAS").Delete();Assert.Contains(Read(missing).Errors,e=>e.Contains("PREGUNTAS"));
    }
}
