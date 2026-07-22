"use client";

import { useSyncExternalStore } from "react";

/**
 * The guest basket — a Moonpig-style cart for one-off buyers who haven't (and
 * may never) sign up. Lives entirely in localStorage so it survives navigation
 * and refreshes in the same browser without an account; it's turned into a real
 * order only at checkout via POST /guest/cart-checkout. Account holders don't
 * use this — they order through the app. See docs/adr/0025.
 *
 * Each item is a template card + the single recipient it's posted to (address
 * included). Personalisation is the template as-is for now, mirroring the guest
 * send flow; a per-item editor can attach a `document` later without changing
 * the storage shape.
 */
const KEY = "kudos:cart";

/** Flat card price in pence — VAT- and postage-inclusive (see billing.constants). */
export const CARD_PRICE_PENCE = 150;

/** Mirror of the API's GUEST_CART_MAX_ITEMS (free-plan per-order cap). */
export const CART_MAX_ITEMS = 20;

export interface CartItem {
  /** Client-generated line id — lets the same card appear for several people. */
  id: string;
  cardDesignId: string;
  cardName: string;
  thumbnailUrl: string;
  recipientFirstName: string;
  recipientLastName: string;
  shippingAddressLine1: string;
  shippingAddressLine2?: string;
  shippingAddressCity: string;
  shippingAddressPostcode: string;
}

/** Stable empty reference for SSR / hydration (useSyncExternalStore needs it). */
const EMPTY: CartItem[] = [];

let items: CartItem[] = readInitial();
const listeners = new Set<() => void>();

function readInitial(): CartItem[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function persist(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Private mode / storage full — the in-memory cart still works for this
    // session; nothing to do.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function set(next: CartItem[]): void {
  items = next;
  persist();
  emit();
}

// Keep the cart in sync across tabs — another tab adding a card updates this one.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) {
      items = readInitial();
      emit();
    }
  });
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): CartItem[] {
  return items;
}

function getServerSnapshot(): CartItem[] {
  return EMPTY;
}

/** Add a card for one recipient. Returns false (and no-ops) at the cap. */
export function addToCart(item: Omit<CartItem, "id">): boolean {
  if (items.length >= CART_MAX_ITEMS) return false;
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  set([...items, { ...item, id }]);
  return true;
}

export function removeFromCart(id: string): void {
  set(items.filter((item) => item.id !== id));
}

export function clearCart(): void {
  set(EMPTY);
}

/** Reactive cart contents for client components. */
export function useCart(): CartItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Reactive item count — for the header basket badge. */
export function useCartCount(): number {
  return useCart().length;
}
