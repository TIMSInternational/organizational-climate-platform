using System.Security.Claims;
using ClimateProject.Api.Infrastructure;
using ClimateProject.Application.Auth;
using ClimateProject.Application.OrgStructure;
using ClimateProject.Application.Surveys;
using ClimateProject.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ClimateProject.Api.Endpoints;

public sealed record WorkbookExistingPerson(Guid Id,string Email,string Role);
public sealed record WorkbookFieldPlan(Guid? Id,string Field,string Label,IReadOnlyList<WorkbookOptionPlan> Options);
public sealed record WorkbookOptionPlan(string Value,string Label,string? LabelEn=null,string? LabelEs=null);
public sealed record ClimateWorkbookPreview(ClimateWorkbookContent Content,Guid? CompanyId,Guid? SurveyId,string? SurveyStatus,
    IReadOnlyList<WorkbookFieldPlan> Fields,IReadOnlyList<WorkbookExistingPerson> ExistingPeople,IReadOnlyList<string> Errors);

public static class ClimateWorkbookEndpoints
{
    public static void MapClimateWorkbookEndpoints(this WebApplication app)
    {
        app.MapPost("/admin/climate-workbooks/preview",PreviewAsync).RequireAuthorization()
            .WithMetadata(new LargeRequestBodyMetadata());
        app.MapGet("/admin/climate-workbooks/template",Template).RequireAuthorization();
    }

    private static bool Matches(WorkbookOptionPlan option,string label,string value)
        =>option.Value==value||ClimateWorkbook.Key(option.Label)==ClimateWorkbook.Key(label)
            ||ClimateWorkbook.Key(option.LabelEn??"")==ClimateWorkbook.Key(label)
            ||ClimateWorkbook.Key(option.LabelEs??"")==ClimateWorkbook.Key(label);

    private static IResult Template(ClaimsPrincipal principal)
    {
        if(!Roles.Admin.Contains(principal.GetCurrentUser().Role))return Results.Forbid();
        var path=Path.Combine(AppContext.BaseDirectory,"Assets","TIMS_NEXA_Clima_Integral.xlsx");
        return Results.File(path,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","TIMS_NEXA_Clima_Integral.xlsx");
    }

    private static async Task<IResult> PreviewAsync(HttpRequest request,ClaimsPrincipal principal,ClimateProjectDbContext db,ILoggerFactory loggerFactory,CancellationToken ct)
    {
        var actor=principal.GetCurrentUser();
        if(!Roles.Admin.Contains(actor.Role))return Results.Forbid();
        if(request.ContentLength>11*1024*1024)return Results.BadRequest(new {message="Seleccione un archivo .xlsx de hasta 10 MB."});
        if(!request.HasFormContentType)return Results.BadRequest(new {message="Suba un archivo Excel como formulario."});
        var form=await request.ReadFormAsync(ct);var file=form.Files["file"];
        if(file is null||file.Length==0||file.Length>10*1024*1024||!file.FileName.EndsWith(".xlsx",StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new {message="Seleccione un archivo .xlsx de hasta 10 MB."});
        ClimateWorkbookReadResult parsed;
        try
        {
            await using var buffer=new MemoryStream();await file.CopyToAsync(buffer,ct);buffer.Position=0;
            parsed=ClimateWorkbook.Read(buffer,DateTimeOffset.UtcNow);
        }
        catch(Exception ex) when(ex is not OperationCanceledException and not OutOfMemoryException)
        {loggerFactory.CreateLogger("ClimateWorkbook").LogWarning(ex,"Could not parse climate workbook upload");return Results.BadRequest(new {message="No se pudo leer el archivo. Guárdelo como .xlsx y revise sus hojas."});}
        if(parsed.Content is not { } content)return Results.BadRequest(new {message=string.Join(" ",parsed.Errors)});
        var errors=parsed.Errors.ToList();
        var company=await db.Companies.SingleOrDefaultAsync(c=>c.EmailDomain==content.Company.EmailDomain,ct);
        if(actor.Role!=Roles.SuperAdmin&&(company is null||actor.CompanyId!=company.Id.ToString()))return Results.Forbid();
        var emails=content.People.Select(p=>p.Email).ToArray();
        var users=await db.Users.Where(u=>emails.Contains(u.Email.ToLower())).ToListAsync(ct);
        foreach(var user in users)
        {
            if(company is null||user.CompanyId!=company.Id)errors.Add($"DEMOGRAFICOS: {user.Email} ya pertenece a otra cuenta o empresa; revise esa fila.");
            else if(!user.IsActive)errors.Add($"DEMOGRAFICOS: {user.Email} está inactivo; revise esa cuenta antes de importar.");
        }
        var pending=await db.UserInvitations.Where(i=>i.Email!=null&&emails.Contains(i.Email.ToLower())&&(i.Status=="pending"||i.Status=="sent")&&i.ExpiresAt>DateTimeOffset.UtcNow).Select(i=>i.Email).ToListAsync(ct);
        foreach(var email in pending)errors.Add($"DEMOGRAFICOS: {email} tiene una invitación de cuenta pendiente; resuélvala antes de importar.");
        var fields=company is null?[]:await db.DemographicFields.Where(f=>f.CompanyId==company.Id).ToListAsync(ct);
        var fieldIds=fields.Select(f=>f.Id).ToArray();
        var options=await db.DemographicFieldOptions.Where(o=>fieldIds.Contains(o.DemographicFieldId)).OrderBy(o=>o.Order).ToListAsync(ct);
        var fieldPlans=new List<WorkbookFieldPlan>();
        foreach(var field in content.Fields.Where(f=>f.Options.Count>0))
        {
            var exact=fields.FirstOrDefault(f=>f.Field==field.Field);
            var candidates=fields.Where(f=>ClimateWorkbook.Key(f.LabelEs??"")==ClimateWorkbook.Key(field.Label)||ClimateWorkbook.Key(f.LabelEn??"")==ClimateWorkbook.Key(field.Label)).ToList();
            if(exact is null&&candidates.Count>1)errors.Add($"DEMOGRAFICOS: {field.Label} corresponde a varios campos existentes.");
            var existing=exact??candidates.FirstOrDefault();
            if(existing is not null&&(!existing.IsActive||existing.Type!="select"))
                errors.Add($"DEMOGRAFICOS: {field.Label} ya existe con un tipo incompatible o está inactivo.");
            var choices=options.Where(o=>o.DemographicFieldId==existing?.Id).Select(o=>new WorkbookOptionPlan(o.Value,o.LabelEs??o.LabelEn??o.Value,o.LabelEn,o.LabelEs)).ToList();
            foreach(var label in field.Options)
            {
                var key=ClimateWorkbook.Slug(label);
                var match=choices.FirstOrDefault(o=>Matches(o,label,key));
                if(match is null)choices.Add(new(key,label));
            }
            fieldPlans.Add(new(existing?.Id,existing?.Field??field.Field,field.Label,choices));
        }
        // New accounts must satisfy required fields too. A missing column cannot turn into
        // partial account creation after the administrator has approved an apparently valid file.
        foreach(var required in fields.Where(f=>f.IsActive&&f.Required))
        {
            var source=content.Fields.FirstOrDefault(f=>f.Field==required.Field||ClimateWorkbook.Key(f.Label)==ClimateWorkbook.Key(required.LabelEs??required.LabelEn??required.Field));
            if(source is null&&content.People.Any(p=>users.All(u=>!string.Equals(u.Email,p.Email,StringComparison.OrdinalIgnoreCase))))
                errors.Add($"DEMOGRAFICOS: falta el campo obligatorio {required.LabelEs??required.LabelEn??required.Field}.");
        }
        // Map file labels to existing stored keys, preserving bilingual/custom option values.
        if(fieldPlans.Select(f=>f.Field).Distinct().Count()!=fieldPlans.Count)
            errors.Add("DEMOGRAFICOS: varias columnas corresponden al mismo campo; unifíquelas.");
        foreach(var required in fields.Where(f=>f.IsActive&&f.Required))
        {
            var source=content.Fields.FirstOrDefault(f=>f.Field==required.Field||ClimateWorkbook.Key(f.Label)==ClimateWorkbook.Key(required.LabelEs??required.LabelEn??required.Field));
            if(source is not null)
                foreach(var person in content.People.Where(p=>users.All(u=>!string.Equals(u.Email,p.Email,StringComparison.OrdinalIgnoreCase))))
                    if(person.Demographics?.ContainsKey(source.Field)!=true)errors.Add($"DEMOGRAFICOS fila {person.RowNumber}: falta {source.Label}.");
        }
        if(errors.Count>0)return Results.Ok(new ClimateWorkbookPreview(content,company?.Id,null,null,fieldPlans,
            users.Where(u=>u.CompanyId==company?.Id).Select(u=>new WorkbookExistingPerson(u.Id,u.Email,u.Role)).ToArray(),errors.Distinct().ToArray()));
        var remapped=content.People.Select(p=>p with {Demographics=p.Demographics?.ToDictionary(kv=>
        {
            var source=content.Fields.First(f=>f.Field==kv.Key);
            return fieldPlans.First(f=>f.Label==source.Label).Field;
        },kv=>
        {
            var source=content.Fields.First(f=>f.Field==kv.Key);
            var label=source.Options.First(v=>ClimateWorkbook.Slug(v)==kv.Value);
            return (string?)fieldPlans.First(f=>f.Label==source.Label).Options.First(o=>Matches(o,label,kv.Value??"")).Value;
        })}).ToArray();
        Guid? surveyId=null;string? status=null;
        if(company is not null)
        {
            var matches=await db.Surveys.Where(s=>s.CompanyId==company.Id&&(s.TitleEs==content.Title||s.TitleEn==content.Title)).ToListAsync(ct);
            if(matches.Count>1)errors.Add("EMPRESA: más de una encuesta tiene ese título. Use un título único para esta medición.");
            else if(matches.SingleOrDefault() is { } survey)
            {
                var questions=await db.Questions.Where(q=>q.SurveyId==survey.Id).OrderBy(q=>q.Order).ToListAsync(ct);
                var questionIds=questions.Select(q=>q.Id).ToArray();
                var savedOptions=await db.QuestionOptions.Where(o=>questionIds.Contains(o.QuestionId)).OrderBy(o=>o.Order).ToListAsync(ct);
                string? Text(string? en,string? es)=>content.Company.Language=="es"?es:en;
                var same=survey.Language==content.Company.Language&&survey.Type=="periodic"&&survey.Settings.NotificationSendInvitations
                    &&survey.Settings.InvitationSendImmediately
                    &&Text(survey.DescriptionEn,survey.DescriptionEs)==content.Description
                    &&Text(survey.Settings.InvitationCustomSubjectEn,survey.Settings.InvitationCustomSubjectEs)==content.InvitationSubject
                    &&(Text(survey.Settings.InvitationCustomMessageEn,survey.Settings.InvitationCustomMessageEs)??"")==(content.InvitationMessage??"")
                    &&survey.StartDate==content.StartDate&&survey.EndDate==content.EndDate&&survey.Settings.Anonymous==content.Company.Anonymous
                    &&questions.Count==content.Questions.Count&&questions.Zip(content.Questions).All(pair=>
                        (content.Company.Language=="es"?pair.First.TextEs:pair.First.TextEn)==pair.Second.Text?.ByLocale?[content.Company.Language]
                        &&pair.First.Type==pair.Second.Type&&pair.First.Category==pair.Second.Category&&pair.First.ScaleMin==pair.Second.ScaleMin&&pair.First.ScaleMax==pair.Second.ScaleMax&&pair.First.Required==pair.Second.Required
                        &&savedOptions.Where(o=>o.QuestionId==pair.First.Id).Select(o=>o.Value+"\n"+Text(o.LabelEn,o.LabelEs))
                            .SequenceEqual((pair.Second.Options??[]).Select(o=>o.Value+"\n"+o.Label?.ByLocale?[content.Company.Language])));
                if(!same||survey.Status is "closed" or "archived")errors.Add("EMPRESA: ya existe una encuesta distinta o cerrada con ese título. Use otro título.");
                else {surveyId=survey.Id;status=survey.Status;}
            }
        }
        var inactiveDepartments=company is null?[]:await db.Departments.Where(d=>d.CompanyId==company.Id&&!d.IsActive).Select(d=>d.Name).ToListAsync(ct);
        foreach(var department in content.People.Select(p=>p.Department).Distinct())
            if(inactiveDepartments.Any(d=>ClimateWorkbook.Key(d)==ClimateWorkbook.Key(department??"")))errors.Add($"DEMOGRAFICOS: el departamento {department} está inactivo.");
        return Results.Ok(new ClimateWorkbookPreview(content with {People=remapped},company?.Id,surveyId,status,fieldPlans,
            users.Where(u=>u.CompanyId==company?.Id).Select(u=>new WorkbookExistingPerson(u.Id,u.Email,u.Role)).ToArray(),errors.Distinct().ToArray()));
    }
}
