/**
 * Registro (a nivel de modulo) de que conversacion esta ABIERTA en pantalla.
 * ChatNotifications lo consulta para no sonar/toastear por mensajes del chat
 * que el usuario ya esta mirando.
 */
let activeChatOrderId: string | null = null;

export function setActiveChat(orderId: string | null): void {
  activeChatOrderId = orderId;
}

export function getActiveChat(): string | null {
  return activeChatOrderId;
}
