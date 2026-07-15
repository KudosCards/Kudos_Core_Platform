import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * Global so every feature module can inject PrismaService without each one
 * re-importing PrismaModule — the DB connection is process-wide infrastructure,
 * not a per-feature dependency.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
