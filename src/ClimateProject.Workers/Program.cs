using ClimateProject.Workers;

// The composition lives in WorkerHostFactory so tests can boot the real host. See its doc
// comment for why that indirection is load-bearing rather than ceremony.
WorkerHostFactory.Create(args).Run();
