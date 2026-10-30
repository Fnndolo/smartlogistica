'use client';

import { useSyncExternalStore } from 'react';

/**
 * ARRASTRAR PEDIDOS a una sede (o de vuelta a generales) desde la tabla.
 *
 * La tabla y el rail lateral viven en arboles distintos (el rail esta en el
 * layout), asi que el arrastre en curso se comparte con un store minimo de
 * modulo: la tabla lo inicia, la capa del arrastre lo mueve y lo suelta, y el
 * rail lo lee para encender las sedes donde se puede soltar.
 *
 * Destinos: 'general' (devolver a generales) o el id de una sede. En el DOM se
 * marcan con data-drop-target="<destino>".
 */

export type DropTarget = 'general' | string;

export interface OrderDragPreview {
  externalId: string;
  customerName: string;
  product: string | null;
}

export interface OrderDragPayload {
  orderIds: string[];
  /** Sede de donde salen (null = generales). Soltar ahi no hace nada. */
  fromWarehouseId: string | null;
  /** false si hay montados a mano: esos no van a generales. */
  canReturn: boolean;
  preview: OrderDragPreview[];
  /** Punto donde se agarro (para devolver la tarjeta si se suelta en el aire). */
  origin: { x: number; y: number };
  /** Lo que pasa al soltar en un destino valido. */
  drop: (target: DropTarget) => void;
}

export interface OrderDragState {
  payload: OrderDragPayload;
  /** Destino bajo el puntero (valido o no) o null. */
  over: DropTarget | null;
}

let state: OrderDragState | null = null;
/** El ultimo destino que RECIBIO pedidos (el rail lo celebra un instante). */
let lastDrop: { target: DropTarget; at: number; count: number } | null = null;
/** Tras soltar, el clic que el navegador dispara no debe abrir el pedido. */
let suppressClickUntil = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const orderDrag = {
  start(payload: OrderDragPayload) {
    state = { payload, over: null };
    emit();
  },
  setOver(over: DropTarget | null) {
    if (!state || state.over === over) return;
    state = { ...state, over };
    emit();
  },
  /** Termina el arrastre; si cayo en un destino, lo deja anotado para el rail. */
  end(dropped: DropTarget | null) {
    if (state && dropped) {
      lastDrop = { target: dropped, at: Date.now(), count: state.payload.orderIds.length };
    }
    state = null;
    suppressClickUntil = Date.now() + 350;
    emit();
  },
  get(): OrderDragState | null {
    return state;
  },
  /** true justo despues de un arrastre: el clic de la fila se ignora. */
  justDragged(): boolean {
    return Date.now() < suppressClickUntil;
  },
};

/** ¿Se puede soltar este arrastre en ese destino? */
export function isValidTarget(payload: OrderDragPayload, target: DropTarget): boolean {
  if (target === 'general') return payload.fromWarehouseId !== null && payload.canReturn;
  return target !== payload.fromWarehouseId;
}

export function useOrderDrag(): OrderDragState | null {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}

export function useLastDrop(): { target: DropTarget; at: number; count: number } | null {
  return useSyncExternalStore(
    subscribe,
    () => lastDrop,
    () => null,
  );
}
