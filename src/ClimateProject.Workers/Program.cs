var builder = Host.CreateDefaultBuilder(args)
    .ConfigureServices(services =>
    {
    });

var host = builder.Build();
host.Run();
