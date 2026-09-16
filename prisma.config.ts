import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI-configuratie (generate, migrate, studio).
 *
 * De verbindings-URL komt uitsluitend uit DATABASE_URL en staat nooit hier.
 * Bewust géén `env(...)`-helper: die faalt bij élk Prisma-commando, ook bij
 * `prisma generate` in postinstall — waardoor een verse clone stukloopt op een
 * database waarmee hij niet eens wilde praten.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? "",
  },
});
