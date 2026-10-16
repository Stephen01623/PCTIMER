# ==========================================
# BUILD STAGE
# ==========================================
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

WORKDIR /src

# Copy project file and restore dependencies
COPY RemotePCTimer.Api.csproj ./
RUN dotnet restore RemotePCTimer.Api.csproj

# Copy backend source files
COPY . ./

# Publish application
RUN dotnet publish RemotePCTimer.Api.csproj \
    --configuration Release \
    --output /app/publish \
    --no-restore


# ==========================================
# RUNTIME STAGE
# ==========================================
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final

WORKDIR /app

ENV ASPNETCORE_ENVIRONMENT=Production

COPY --from=build /app/publish .

# Render assigns the port through PORT
CMD ["sh", "-c", "dotnet RemotePCTimer.Api.dll --urls http://0.0.0.0:${PORT:-10000}"]