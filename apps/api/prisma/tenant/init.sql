-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "invoicePrefix" TEXT,
    "certificateTemplate" JSONB,
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
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoordinadoraConnection_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "WarehouseMember" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseMember_pkey" PRIMARY KEY ("id")
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
    "warehouseId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "guideNumber" TEXT,
    "shippingState" TEXT,
    "shippingStatus" TEXT,
    "shippingUpdatedAt" TIMESTAMP(3),
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
    "imeis" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMessage_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "AlegraConnection_warehouseId_key" ON "AlegraConnection"("warehouseId");

-- CreateIndex
CREATE INDEX "WarehouseMember_userId_idx" ON "WarehouseMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseMember_warehouseId_userId_key" ON "WarehouseMember"("warehouseId", "userId");

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
CREATE UNIQUE INDEX "Order_provider_externalId_key" ON "Order"("provider", "externalId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderMessage_orderId_createdAt_idx" ON "OrderMessage"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "CoordinadoraConnection" ADD CONSTRAINT "CoordinadoraConnection_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlegraConnection" ADD CONSTRAINT "AlegraConnection_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseMember" ADD CONSTRAINT "WarehouseMember_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderMessage" ADD CONSTRAINT "OrderMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

