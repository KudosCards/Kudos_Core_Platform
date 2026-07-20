-- CreateIndex
CREATE INDEX "accounts_created_at_idx" ON "accounts"("created_at");

-- CreateIndex
CREATE INDEX "batch_orders_status_created_at_idx" ON "batch_orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "batch_orders_created_at_idx" ON "batch_orders"("created_at");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

