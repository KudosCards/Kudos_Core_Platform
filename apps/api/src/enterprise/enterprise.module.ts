import { Module } from "@nestjs/common";
import { EnterpriseService } from "./enterprise.service";
import { EnterprisePublicController } from "./enterprise-public.controller";
import { EnterpriseOpsController } from "./enterprise-ops.controller";
import { EmailModule } from "../email/email.module";

@Module({
  imports: [EmailModule],
  controllers: [EnterprisePublicController, EnterpriseOpsController],
  providers: [EnterpriseService],
})
export class EnterpriseModule {}
