import { Module } from "@nestjs/common";
import { TeamController } from "./team.controller";
import { InvitesController } from "./invites.controller";
import { TeamService } from "./team.service";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [EntitlementsModule, AuditModule, NotificationsModule],
  controllers: [TeamController, InvitesController],
  providers: [TeamService],
})
export class TeamModule {}
