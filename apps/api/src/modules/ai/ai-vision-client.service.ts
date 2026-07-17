import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import type { AiProvider } from '@smartlogistica/shared';

const REQUEST_TIMEOUT_MS = 15_000;
const VISION_TIMEOUT_MS = 45_000;
const ANTHROPIC_VERSION = '2023-06-01';
const VISION_MAX_TOKENS = 400;

/** MIME de imagen soportados por los proveedores de vision. */
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface AiCredentialsRaw {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

/**
 * Cliente de proveedores de IA con vision (OpenAI / Gemini / Anthropic).
 *
 * Por ahora solo valida credenciales (endpoint de listado de modelos de cada
 * proveedor). La extraccion de IMEI desde la imagen se agrega en el incremento
 * "Foto IMEI" — para el path de Anthropic (Claude) se usara el SDK oficial
 * @anthropic-ai/sdk (Messages API con bloque image base64), no HTTP crudo.
 */
@Injectable()
export class AiVisionClient {
  private readonly logger = new Logger(AiVisionClient.name);

  /**
   * Verifica que la API key funciona pegandole al endpoint de listado de modelos
   * del proveedor. No consume tokens ni persiste nada. Devuelve cuantos modelos
   * expone la cuenta (informativo).
   */
  async testCredentials(creds: AiCredentialsRaw): Promise<{ ok: true; modelCount: number | null }> {
    switch (creds.provider) {
      case 'openai':
        return this.testOpenAi(creds.apiKey);
      case 'gemini':
        return this.testGemini(creds.apiKey);
      case 'anthropic':
        return this.testAnthropic(creds.apiKey);
    }
  }

  private async testOpenAi(apiKey: string): Promise<{ ok: true; modelCount: number | null }> {
    const res = await axios.get('https://api.openai.com/v1/models', {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    const count = Array.isArray(res.data?.data) ? res.data.data.length : null;
    return { ok: true, modelCount: count };
  }

  private async testGemini(apiKey: string): Promise<{ ok: true; modelCount: number | null }> {
    const res = await axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
      timeout: REQUEST_TIMEOUT_MS,
      params: { key: apiKey },
      headers: { Accept: 'application/json' },
    });
    const count = Array.isArray(res.data?.models) ? res.data.models.length : null;
    return { ok: true, modelCount: count };
  }

  private async testAnthropic(apiKey: string): Promise<{ ok: true; modelCount: number | null }> {
    const res = await axios.get('https://api.anthropic.com/v1/models', {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        Accept: 'application/json',
      },
    });
    const count = Array.isArray(res.data?.data) ? res.data.data.length : null;
    return { ok: true, modelCount: count };
  }

  // === Vision: leer los IMEI de una imagen ===

  /**
   * Manda la imagen (base64) + un prompt al modelo de vision y devuelve el TEXTO
   * crudo. El prompt lo decide el caller (IMEI o serial son independientes). El
   * parseo/validacion se hace aparte. Anthropic usa el SDK oficial; OpenAI/Gemini HTTP.
   */
  async describeImage(
    creds: AiCredentialsRaw,
    imageBase64: string,
    mimeType: ImageMime,
    prompt: string,
  ): Promise<string> {
    switch (creds.provider) {
      case 'openai':
        return this.openaiVision(creds.apiKey, creds.model, imageBase64, mimeType, prompt);
      case 'gemini':
        return this.geminiVision(creds.apiKey, creds.model, imageBase64, mimeType, prompt);
      case 'anthropic':
        return this.anthropicVision(creds.apiKey, creds.model, imageBase64, mimeType, prompt);
    }
  }

  private async openaiVision(
    apiKey: string,
    model: string,
    data: string,
    mime: ImageMime,
    prompt: string,
  ): Promise<string> {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        max_tokens: VISION_MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } },
            ],
          },
        ],
      },
      {
        timeout: VISION_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      },
    );
    return res.data?.choices?.[0]?.message?.content ?? '';
  }

  private async geminiVision(
    apiKey: string,
    model: string,
    data: string,
    mime: ImageMime,
    prompt: string,
  ): Promise<string> {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        contents: [
          {
            parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }],
          },
        ],
      },
      {
        timeout: VISION_TIMEOUT_MS,
        params: { key: apiKey },
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const parts = res.data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map((p: { text?: string }) => p.text ?? '').join('\n');
  }

  private async anthropicVision(
    apiKey: string,
    model: string,
    data: string,
    mime: ImageMime,
    prompt: string,
  ): Promise<string> {
    const client = new Anthropic({ apiKey, timeout: VISION_TIMEOUT_MS });
    const msg = await client.messages.create({
      model,
      max_tokens: VISION_MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  // === Texto (sin imagen) — usado para transformar la direccion a DIAN ===

  async completeText(creds: AiCredentialsRaw, prompt: string): Promise<string> {
    switch (creds.provider) {
      case 'openai':
        return this.openaiText(creds.apiKey, creds.model, prompt);
      case 'gemini':
        return this.geminiText(creds.apiKey, creds.model, prompt);
      case 'anthropic':
        return this.anthropicText(creds.apiKey, creds.model, prompt);
    }
  }

  private async openaiText(apiKey: string, model: string, prompt: string): Promise<string> {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] },
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      },
    );
    return res.data?.choices?.[0]?.message?.content ?? '';
  }

  private async geminiText(apiKey: string, model: string, prompt: string): Promise<string> {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: REQUEST_TIMEOUT_MS, params: { key: apiKey }, headers: { 'Content-Type': 'application/json' } },
    );
    const parts = res.data?.candidates?.[0]?.content?.parts;
    return Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text ?? '').join('') : '';
  }

  private async anthropicText(apiKey: string, model: string, prompt: string): Promise<string> {
    const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    const msg = await client.messages.create({
      model,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
}
