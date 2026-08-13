import { Injectable } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

const BASE_URL = 'https://ap.whapify.ai/api';
const TIMEOUT_MS = 30_000;

/** Contacto de Whapify (solo lo que usamos). */
export interface WhapifyContact {
  id: string;
  name: string | null;
  phone: string | null;
}

interface RawContact {
  id?: number | string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

/**
 * Cliente HTTP del API oficial de Whapify (Appcontx). Auth = header
 * X-ACCESS-TOKEN. El API SOLO permite contactos + envios (texto/archivo/flow):
 * NO expone historial de chat — por eso el historial vive en nuestras tablas.
 */
@Injectable()
export class WhapifyClient {
  buildHttp(token: string): AxiosInstance {
    return axios.create({
      baseURL: BASE_URL,
      timeout: TIMEOUT_MS,
      headers: { 'X-ACCESS-TOKEN': token, Accept: 'application/json' },
    });
  }

  /** Valida el token con /accounts/me. Devuelve nombre de la cuenta + contactos. */
  async testToken(token: string): Promise<{ accountName: string | null; totalContacts: number | null }> {
    const res = await this.buildHttp(token).get<{ name?: string; total_users?: string | number }>(
      '/accounts/me',
    );
    const total = Number(res.data?.total_users);
    return {
      accountName: res.data?.name ?? null,
      totalContacts: Number.isFinite(total) ? total : null,
    };
  }

  /**
   * Busca un contacto por telefono. Whapify guarda el numero con indicativo
   * (57...): se prueba con y sin '+'. Devuelve el primero o null.
   */
  async findContactByPhone(http: AxiosInstance, phoneDigits: string): Promise<WhapifyContact | null> {
    for (const value of [`+${phoneDigits}`, phoneDigits]) {
      const res = await http.get('/contacts/find_by_custom_field', {
        params: { field_id: 'phone', value },
      });
      const list: RawContact[] = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      const first = list[0];
      if (first?.id != null) return this.toContact(first);
    }
    return null;
  }

  /** Crea el contacto (telefono con indicativo). Whapify hace upsert por telefono. */
  async createContact(
    http: AxiosInstance,
    input: {
      phone: string;
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
    },
  ): Promise<WhapifyContact | null> {
    const res = await http.post('/contacts', {
      phone: input.phone,
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
      ...(input.email ? { email: input.email } : {}),
    });
    const raw: RawContact = res.data?.data ?? res.data ?? {};
    return raw.id != null ? this.toContact(raw) : null;
  }

  /** Envia un TEXTO al contacto por el canal de WhatsApp. */
  async sendText(http: AxiosInstance, contactId: string, text: string): Promise<void> {
    await http.post(`/contacts/${encodeURIComponent(contactId)}/send/text`, {
      text,
      channel: 'whatsapp',
    });
  }

  /** Envia un ARCHIVO (por URL publica/firmada) al contacto por WhatsApp. */
  async sendFile(
    http: AxiosInstance,
    contactId: string,
    url: string,
    type: 'image' | 'video' | 'audio' | 'file',
  ): Promise<void> {
    await http.post(`/contacts/${encodeURIComponent(contactId)}/send/file`, {
      url,
      type,
      channel: 'whatsapp',
    });
  }

  /** Setea un CUSTOM FIELD del contacto (form-urlencoded, como el flujo de n8n). */
  async setCustomField(
    http: AxiosInstance,
    contactId: string,
    fieldId: string,
    value: string,
  ): Promise<void> {
    await http.post(
      `/contacts/${encodeURIComponent(contactId)}/custom_fields/${encodeURIComponent(fieldId)}`,
      new URLSearchParams({ value }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
  }

  /** Dispara un FLOW de Whapify al contacto (ej. el de confirmacion del pedido). */
  async sendFlow(http: AxiosInstance, contactId: string, flowId: string): Promise<void> {
    await http.post(
      `/contacts/${encodeURIComponent(contactId)}/send/${encodeURIComponent(flowId)}`,
    );
  }

  private toContact(raw: RawContact): WhapifyContact {
    const name =
      raw.full_name ??
      [raw.first_name, raw.last_name].filter(Boolean).join(' ').trim();
    return {
      id: String(raw.id),
      name: name || null,
      phone: raw.phone ?? null,
    };
  }
}
