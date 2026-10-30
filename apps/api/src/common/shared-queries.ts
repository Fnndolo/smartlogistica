/**
 * Lecturas IDENTICAS pedidas a la vez por muchas pestañas.
 *
 * Cada evento de pedidos (asignar, tomar, facturar, una guia, un pedido nuevo
 * de VTEX...) hace que TODAS las pestañas abiertas recarguen a la vez su lista,
 * su conteo y su pulso: con 15 pestañas eran ~90 consultas en el mismo
 * segundo, la base se llenaba y todo lo demas esperaba en fila. Las que piden
 * exactamente lo mismo (misma clave) comparten la consulta en vuelo, y el
 * resultado vale `ttlMs` o hasta que el tenant sube de generacion (`bump`,
 * con cada evento que cambia pedidos).
 *
 * El acceso NO se cachea: cada peticion valida sus permisos ANTES de pedir aqui,
 * y la clave tiene que incluir todo lo que cambia el resultado.
 */
export class SharedQueries {
  private readonly entries = new Map<
    string,
    { gen: number; at: number; value: Promise<unknown> }
  >();
  private readonly gens = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  bump(tenantId: string): void {
    this.gens.set(tenantId, (this.gens.get(tenantId) ?? 0) + 1);
  }

  run<T>(tenantId: string, key: string, load: () => Promise<T>): Promise<T> {
    const k = `${tenantId}|${key}`;
    const gen = this.gens.get(tenantId) ?? 0;
    const now = Date.now();
    const hit = this.entries.get(k);
    if (hit && hit.gen === gen && now - hit.at < this.ttlMs) return hit.value as Promise<T>;
    // Las busquedas generan claves sueltas: se barren las vencidas.
    if (this.entries.size > 500) {
      for (const [key2, e] of this.entries) {
        if (now - e.at >= this.ttlMs) this.entries.delete(key2);
      }
    }
    const value = load();
    this.entries.set(k, { gen, at: now, value });
    // Un fallo no se queda guardado: la siguiente peticion reintenta.
    value.catch(() => {
      if (this.entries.get(k)?.value === value) this.entries.delete(k);
    });
    return value;
  }
}
