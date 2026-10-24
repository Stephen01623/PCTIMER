using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RemotePCTimer.Api.Migrations
{
    /// <inheritdoc />
    public partial class voucher : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "vouchers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CodeHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    DurationMinutes = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RedeemedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RedeemedByDeviceId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vouchers", x => x.Id);
                    table.CheckConstraint("CK_vouchers_duration", "\"DurationMinutes\" IN (30, 60, 120)");
                    table.CheckConstraint("CK_vouchers_status", "\"Status\" IN ('Available', 'Redeemed', 'Revoked')");
                });

            migrationBuilder.CreateIndex(
                name: "IX_vouchers_CodeHash",
                table: "vouchers",
                column: "CodeHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "vouchers");
        }
    }
}
