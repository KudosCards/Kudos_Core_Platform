-- AlterTable
ALTER TABLE "occasions" ADD COLUMN     "dispatch_option" "DispatchOption" NOT NULL DEFAULT 'asap',
ADD COLUMN     "postage_class" "PostageClass" NOT NULL DEFAULT 'second_class';
