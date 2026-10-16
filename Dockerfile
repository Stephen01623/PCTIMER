# ==========================================
# BUILD STAGE
# ==========================================
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

WORKDIR /src

# Copy the backend project file
COPY backend/RemotePCTimer.Api/*.csproj ./RemotePCTimer.Api/

# Restore NuGet dependencies
RUN dotnet restore ./RemotePCTimer.Api/RemotePCTimer.Api.csproj

# Copy the backend source code
COPY backend/RemotePCTimer.Api/ ./RemotePCTimer.Api/

# Publish the application
WORKDIR /src/RemotePCTimer.Api

RUN dotnet publish RemotePCTimer.Api.csproj \
    --configuration Release \
    --output /app/publish \
    --no-restore


# ==========================================
# RUNTIME STAGE
# ==========================================
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final

WORKDIR /app

# Render provides the PORT environment variable
ENV ASPNETCORE_ENVIRONMENT=Production

COPY --from=build /app/publish .

# Start the API and listen on Render's assigned port
CMD ["sh", "-c", "dotnet RemotePCTimer.Api.dll --urls http://0.0.0.0:${PORT:-10000}"]