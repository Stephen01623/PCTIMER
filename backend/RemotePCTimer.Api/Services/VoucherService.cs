using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using RemotePCTimer.Api.Data;
using RemotePCTimer.Api.DTOs;
using RemotePCTimer.Api.Models;

namespace RemotePCTimer.Api.Services;

public interface IVoucherService
{
    Task<List<GeneratedVoucherResponse>> CreateAsync(
        int durationMinutes,
        int quantity,
        CancellationToken cancellationToken);

    Task<List<VoucherListItemResponse>> GetAllAsync(
        CancellationToken cancellationToken);

    Task<(bool Success, string Message, RedeemVoucherResponse? Data)>
        RedeemAsync(
            string code,
            string deviceId,
            CancellationToken cancellationToken);
}

public class VoucherService : IVoucherService
{
    private readonly TimerDbContext _dbContext;
    private readonly ITimerService _timerService;

    public VoucherService(
        TimerDbContext dbContext,
        ITimerService timerService)
    {
        _dbContext = dbContext;
        _timerService = timerService;
    }

    public async Task<List<GeneratedVoucherResponse>> CreateAsync(
        int durationMinutes,
        int quantity,
        CancellationToken cancellationToken)
    {
        if (durationMinutes is not (30 or 60 or 120))
        {
            throw new ArgumentOutOfRangeException(
                nameof(durationMinutes),
                "Duration must be 30, 60, or 120 minutes.");
        }

        if (quantity is < 1 or > 100)
        {
            throw new ArgumentOutOfRangeException(
                nameof(quantity),
                "Quantity must be between 1 and 100.");
        }

        var results = new List<GeneratedVoucherResponse>();

        for (var i = 0; i < quantity; i++)
        {
            string code;
            string hash;

            do
            {
                code = GenerateCode();
                hash = HashCode(code);
            }
            while (await _dbContext.Vouchers
                .AnyAsync(v => v.CodeHash == hash, cancellationToken));

            var voucher = new Voucher
            {
                Id = Guid.NewGuid(),
                CodeHash = hash,
                DurationMinutes = durationMinutes,
                Status = "Available",
                CreatedAtUtc = DateTime.UtcNow
            };

            _dbContext.Vouchers.Add(voucher);

            // The plain code is returned only at creation time.
            results.Add(new GeneratedVoucherResponse
            {
                Id = voucher.Id,
                Code = code,
                DurationMinutes = durationMinutes,
                Status = voucher.Status,
                CreatedAtUtc = voucher.CreatedAtUtc
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return results;
    }

    public async Task<List<VoucherListItemResponse>> GetAllAsync(
        CancellationToken cancellationToken)
    {
        return await _dbContext.Vouchers
            .AsNoTracking()
            .OrderByDescending(v => v.CreatedAtUtc)
            .Select(v => new VoucherListItemResponse
            {
                Id = v.Id,
                DurationMinutes = v.DurationMinutes,
                Status = v.Status,
                CreatedAtUtc = v.CreatedAtUtc,
                RedeemedAtUtc = v.RedeemedAtUtc,
                RedeemedByDeviceId = v.RedeemedByDeviceId
            })
            .ToListAsync(cancellationToken);
    }

    public async Task<(
        bool Success,
        string Message,
        RedeemVoucherResponse? Data)> RedeemAsync(
            string code,
            string deviceId,
            CancellationToken cancellationToken)
    {
        var normalizedCode = NormalizeCode(code);
        var hash = HashCode(normalizedCode);

        await using var transaction =
            await _dbContext.Database.BeginTransactionAsync(
                cancellationToken);

        var voucher = await _dbContext.Vouchers
            .FirstOrDefaultAsync(
                v => v.CodeHash == hash,
                cancellationToken);

        if (voucher is null)
        {
            return (false, "Invalid voucher code.", null);
        }

        if (voucher.Status != "Available")
        {
            return (false, "This voucher has already been used or revoked.", null);
        }

        var redeemedAt = DateTime.UtcNow;

        // Conditional update prevents two computers from redeeming
        // the same voucher simultaneously.
        var updated = await _dbContext.Vouchers
            .Where(v =>
                v.Id == voucher.Id &&
                v.Status == "Available")
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(v => v.Status, "Redeemed")
                    .SetProperty(v => v.RedeemedAtUtc, redeemedAt)
                    .SetProperty(v => v.RedeemedByDeviceId, deviceId),
                cancellationToken);

        if (updated != 1)
        {
            return (false, "This voucher has already been used.", null);
        }

        // IMPORTANT:
        // This assumes ITimerService uses this same scoped DbContext.
        // Confirm its implementation before deploying this transaction.
        var timer = await _timerService.SetTimerAsync(
    voucher.DurationMinutes,
    cancellationToken);

if (timer.EndsAtUtc is null)
{
    throw new InvalidOperationException(
        "Timer end time was not set after voucher redemption.");
}

await transaction.CommitAsync(cancellationToken);

return (true, "Voucher redeemed successfully.", new RedeemVoucherResponse
{
    Message = "Voucher redeemed successfully.",
    DurationMinutes = voucher.DurationMinutes,
    RedeemedAtUtc = redeemedAt,
    EndsAtUtc = timer.EndsAtUtc.Value
});
    }

    private static string GenerateCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

        var randomBytes = RandomNumberGenerator.GetBytes(12);
        var chars = new char[12];

        for (var i = 0; i < chars.Length; i++)
        {
            chars[i] = alphabet[randomBytes[i] % alphabet.Length];
        }

        var raw = new string(chars);

        return $"RPT-{raw[..4]}-{raw[4..8]}-{raw[8..12]}";
    }

    private static string NormalizeCode(string code)
    {
        return code.Trim()
            .Replace("-", string.Empty)
            .ToUpperInvariant();
    }

    private static string HashCode(string code)
    {
        var normalized = NormalizeCode(code);
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));

        return Convert.ToHexString(bytes);
    }
}