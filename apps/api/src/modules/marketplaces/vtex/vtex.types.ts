/**
 * Tipos minimos para los responses de VTEX OMS que consumimos.
 * Cubren solo los campos que SmartLogistica utiliza; resto se preserva en rawPayload.
 */

export interface VtexOrderListItem {
  orderId: string;
  status: string;
  statusDescription: string;
  creationDate: string;
  lastChange: string;
  totalValue: number;
  currencyCode: string;
  clientName: string;
}

export interface VtexOrderListResponse {
  list: VtexOrderListItem[];
  paging: {
    total: number;
    pages: number;
    currentPage: number;
    perPage: number;
  };
}

export interface VtexOrderItem {
  id: string;
  refId?: string;
  name: string;
  quantity: number;
  price: number;
  imageUrl?: string;
}

export interface VtexOrderDetail {
  orderId: string;
  status: string;
  creationDate: string;
  lastChange: string;
  value: number;
  currencyCode: string;
  clientProfileData: {
    firstName?: string;
    lastName?: string;
    email?: string;
    document?: string;
    documentType?: string;
    phone?: string;
  };
  items: VtexOrderItem[];
  [key: string]: unknown;
}

export interface VtexWebhookConfigRequest {
  filter: {
    type: 'FromWorkflow';
    status: string[];
  };
  hook: {
    url: string;
    headers: Record<string, string>;
  };
}

export interface VtexWebhookPayload {
  OrderId: string;
  State: string;
  LastChange: string;
  Domain?: string;
  [key: string]: unknown;
}
