-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "invoicePrefix" TEXT,
    "certificateTemplate" JSONB,
    "certificateMode" TEXT NOT NULL DEFAULT 'template',
    "packagePresets" JSONB,
    "alegraFixedClient" JSONB,
    "alegraBodega" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoordinadoraConnection" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "idCliente" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "encryptedPassword" BYTEA NOT NULL,
    "nit" TEXT NOT NULL,
    "div" TEXT NOT NULL DEFAULT '01',
    "rotuloId" INTEGER NOT NULL DEFAULT 55,
    "senderName" TEXT NOT NULL,
    "senderNit" TEXT,
    "senderPhone" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "senderCityCode" TEXT NOT NULL,
    "senderCityName" TEXT,
    "senderPostalCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoordinadoraConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalCertificateConnection" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedApiKey" BYTEA NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCertificateConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlegraConnection" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "encryptedToken" BYTEA NOT NULL,
    "companyName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlegraConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperMentionAlert" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),

    CONSTRAINT "SuperMentionAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderReaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AlegraSellerPref" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlegraSellerPref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseMember" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "attachmentKey" TEXT,
    "mediaUrl" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "contactId" TEXT,
    "buttons" JSONB,
    "replyToId" TEXT,
    "reactions" JSONB,
    "status" TEXT,
    "error" TEXT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "lineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaLine" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'dialog360',
    "phone" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT '57',
    "encryptedApiKey" BYTEA NOT NULL,
    "encryptedAppSecret" BYTEA,
    "phoneNumberId" TEXT,
    "wabaId" TEXT,
    "verifyToken" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'production',
    "webhookUrl" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaFlow" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scope" JSONB NOT NULL DEFAULT '["*"]',
    "config" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaContact" (
    "phone" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "name" TEXT,
    "labels" JSONB,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "flowState" TEXT,
    "draftAddress" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaContact_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "WaLabel" (
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#00a884',

    CONSTRAINT "WaLabel_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "WaStickerFav" (
    "id" TEXT NOT NULL,
    "attachmentKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaStickerFav_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaChatRead" (
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaChatRead_pkey" PRIMARY KEY ("userId","phone")
);

-- CreateTable
CREATE TABLE "SkydropxSedeConfig" (
    "warehouseId" TEXT NOT NULL,
    "addressTemplateId" TEXT NOT NULL,
    "alias" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkydropxSedeConfig_pkey" PRIMARY KEY ("warehouseId")
);

-- CreateTable
CREATE TABLE "SkydropxConnection" (
    "id" TEXT NOT NULL,
    "encryptedApiKey" BYTEA NOT NULL,
    "encryptedApiSecret" BYTEA NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkydropxConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddiLbaConnection" (
    "id" TEXT NOT NULL,
    "portalEmail" TEXT NOT NULL,
    "encryptedPortalPassword" BYTEA NOT NULL,
    "suiteEmail" TEXT NOT NULL,
    "encryptedSuitePassword" BYTEA NOT NULL,
    "autoSender" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddiLbaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "encryptedApiKey" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlegraImeiIndex" (
    "id" TEXT NOT NULL,
    "imei" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "billNumber" TEXT,
    "billDate" TIMESTAMP(3),
    "providerName" TEXT,
    "itemName" TEXT,
    "unitCost" DECIMAL(14,2),
    "sourceWarehouseId" TEXT NOT NULL,
    "observations" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlegraImeiIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "label" TEXT,
    "encryptedAppKey" BYTEA NOT NULL,
    "encryptedAppToken" BYTEA NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerDocument" TEXT,
    "customerPhone" TEXT,
    "status" TEXT NOT NULL,
    "totalValue" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "totalUnits" INTEGER NOT NULL DEFAULT 0,
    "primaryProduct" TEXT,
    "warehouseId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "guideNumber" TEXT,
    "shippingState" TEXT,
    "shippingStatus" TEXT,
    "shippingUpdatedAt" TIMESTAMP(3),
    "shippingProvider" TEXT,
    "skydropxShipmentId" TEXT,
    "addiGuide" TEXT,
    "addiShipment" JSONB,
    "addiSenderPendingAt" TIMESTAMP(3),
    "addiSenderWarehouseId" TEXT,
    "addiSenderAt" TIMESTAMP(3),
    "addiSenderError" TEXT,
    "addressStatus" TEXT,
    "confirmedAddress" TEXT,
    "addressConfirmedAt" TIMESTAMP(3),
    "claimedById" TEXT,
    "claimedByName" TEXT,
    "claimedAt" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "packedById" TEXT,
    "packedByName" TEXT,
    "marketplaceCreatedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMessage" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "attachmentKey" TEXT,
    "attachmentUrl" TEXT,
    "attachmentMime" TEXT,
    "caption" TEXT,
    "imeis" TEXT[],
    "mentions" TEXT[],
    "replyToId" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMessageEdit" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "previousBody" TEXT,
    "editedById" TEXT NOT NULL,
    "editedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessageEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRead" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "signature" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfirmationLog" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "address" TEXT,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfirmationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_slug_key" ON "Warehouse"("slug");

-- CreateIndex
CREATE INDEX "Warehouse_archived_idx" ON "Warehouse"("archived");

-- CreateIndex
CREATE UNIQUE INDEX "CoordinadoraConnection_warehouseId_key" ON "CoordinadoraConnection"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCertificateConnection_warehouseId_key" ON "ExternalCertificateConnection"("warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "AlegraConnection_warehouseId_key" ON "AlegraConnection"("warehouseId");

-- CreateIndex
CREATE INDEX "SuperMentionAlert_userId_seenAt_idx" ON "SuperMentionAlert"("userId", "seenAt");

-- CreateIndex
CREATE INDEX "OrderReaction_orderId_idx" ON "OrderReaction"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderReaction_orderId_userId_emoji_key" ON "OrderReaction"("orderId", "userId", "emoji");

-- CreateIndex
CREATE UNIQUE INDEX "AlegraSellerPref_warehouseId_userId_key" ON "AlegraSellerPref"("warehouseId", "userId");

-- CreateIndex
CREATE INDEX "WarehouseMember_userId_idx" ON "WarehouseMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseMember_warehouseId_userId_key" ON "WarehouseMember"("warehouseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_externalId_key" ON "WaMessage"("externalId");

-- CreateIndex
CREATE INDEX "WaMessage_phone_createdAt_idx" ON "WaMessage"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "WaMessage_lineId_createdAt_idx" ON "WaMessage"("lineId", "createdAt");

-- CreateIndex
CREATE INDEX "WaLine_status_idx" ON "WaLine"("status");

-- CreateIndex
CREATE INDEX "WaFlow_kind_enabled_idx" ON "WaFlow"("kind", "enabled");

-- CreateIndex
CREATE INDEX "WaFlow_lineId_idx" ON "WaFlow"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "WaStickerFav_attachmentKey_key" ON "WaStickerFav"("attachmentKey");

-- CreateIndex
CREATE UNIQUE INDEX "AlegraImeiIndex_imei_key" ON "AlegraImeiIndex"("imei");

-- CreateIndex
CREATE INDEX "AlegraImeiIndex_sourceWarehouseId_idx" ON "AlegraImeiIndex"("sourceWarehouseId");

-- CreateIndex
CREATE INDEX "AlegraImeiIndex_billId_idx" ON "AlegraImeiIndex"("billId");

-- CreateIndex
CREATE INDEX "MarketplaceConnection_provider_status_idx" ON "MarketplaceConnection"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceConnection_provider_accountName_key" ON "MarketplaceConnection"("provider", "accountName");

-- CreateIndex
CREATE INDEX "Order_status_marketplaceCreatedAt_idx" ON "Order"("status", "marketplaceCreatedAt" DESC);

-- CreateIndex
CREATE INDEX "Order_status_totalUnits_idx" ON "Order"("status", "totalUnits");

-- CreateIndex
CREATE INDEX "Order_status_totalValue_idx" ON "Order"("status", "totalValue");

-- CreateIndex
CREATE INDEX "Order_provider_status_idx" ON "Order"("provider", "status");

-- CreateIndex
CREATE INDEX "Order_warehouseId_status_idx" ON "Order"("warehouseId", "status");

-- CreateIndex
CREATE INDEX "Order_warehouseId_shippingState_idx" ON "Order"("warehouseId", "shippingState");

-- CreateIndex
CREATE INDEX "Order_receivedAt_idx" ON "Order"("receivedAt" DESC);

-- CreateIndex
CREATE INDEX "Order_invoicedAt_idx" ON "Order"("invoicedAt" DESC);

-- CreateIndex
CREATE INDEX "Order_packedAt_idx" ON "Order"("packedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_provider_accountName_externalId_key" ON "Order"("provider", "accountName", "externalId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderMessage_orderId_createdAt_idx" ON "OrderMessage"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderMessageEdit_messageId_createdAt_idx" ON "OrderMessageEdit"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_messageId_userId_emoji_key" ON "MessageReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "OrderRead_userId_idx" ON "OrderRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRead_orderId_userId_key" ON "OrderRead"("orderId", "userId");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "ConfirmationLog_createdAt_idx" ON "ConfirmationLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "CoordinadoraConnection" ADD CONSTRAINT "CoordinadoraConnection_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalCertificateConnection" ADD CONSTRAINT "ExternalCertificateConnection_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlegraConnection" ADD CONSTRAINT "AlegraConnection_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperMentionAlert" ADD CONSTRAINT "SuperMentionAlert_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReaction" ADD CONSTRAINT "OrderReaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlegraSellerPref" ADD CONSTRAINT "AlegraSellerPref_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseMember" ADD CONSTRAINT "WarehouseMember_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaFlow" ADD CONSTRAINT "WaFlow_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "WaLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessageEdit" ADD CONSTRAINT "OrderMessageEdit_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OrderMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OrderMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRead" ADD CONSTRAINT "OrderRead_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

