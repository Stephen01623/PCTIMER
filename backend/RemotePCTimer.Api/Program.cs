using Microsoft.EntityFrameworkCore;
using RemotePCTimer.Api.Data;
using RemotePCTimer.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// Controllers
builder.Services.AddControllers();

// Neon PostgreSQL database
builder.Services.AddDbContext<TimerDbContext>(options =>
{
    var connectionString =
        builder.Configuration.GetConnectionString("Neon");

    if (string.IsNullOrWhiteSpace(connectionString))
    {
        throw new InvalidOperationException(
            "Missing ConnectionStrings:Neon configuration. " +
            "Check appsettings.json or User Secrets.");
    }

    options.UseNpgsql(connectionString);
});

// Timer service
builder.Services.AddScoped<ITimerService, TimerService>();

// Swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Swagger for local development and testing
app.UseSwagger();
app.UseSwaggerUI();

// Map API controllers
app.MapControllers();

app.Run();