import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import { StorageService, type SignedUpload } from "./storage.service";
import { CreateUploadDto } from "./dto/create-upload.dto";

@ApiTags("uploads")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("uploads")
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post("design-assets")
  createDesignAssetUpload(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: CreateUploadDto,
  ): Promise<SignedUpload> {
    return this.storageService.createSignedUpload(membership.accountId, dto);
  }
}
