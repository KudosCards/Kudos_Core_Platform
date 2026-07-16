import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import {
  StorageService,
  DESIGN_ASSETS_BUCKET,
  MESSAGE_VIDEOS_BUCKET,
  type SignedUpload,
} from "./storage.service";
import { CreateUploadDto } from "./dto/create-upload.dto";
import { CreateVideoUploadDto } from "./dto/create-video-upload.dto";

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
    return this.storageService.createSignedUpload(DESIGN_ASSETS_BUCKET, membership.accountId, dto);
  }

  @Post("message-videos")
  createMessageVideoUpload(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: CreateVideoUploadDto,
  ): Promise<SignedUpload> {
    return this.storageService.createSignedUpload(
      MESSAGE_VIDEOS_BUCKET,
      membership.accountId,
      dto,
    );
  }
}
