// ============================================================
//  PRINCIPIO DE SUSTITUCION DE LISKOV (LSP) - SOLID
//  Contexto: Origenes de pedidos (marketplaces) - IS-III FI303290
//  PARTE 1: DISENO QUE VIOLA EL LSP
// ============================================================
//
//  Liskov es sencillo de decir: donde nosotros esperamos al papa,
//  deberia poder llegar cualquiera de los hijos y que la cosa
//  siga funcionando igual. Si el hijo se revienta o pide mas
//  requisitos que el papa, ahi rompimos el principio.
//
//  Aca tenemos una clase Marketplace y de ella heredan VTEX,
//  Addi y los pedidos manuales (los que montamos a mano en la
//  sede). El problema es que los manuales NO tienen API, o sea
//  no pueden cumplir lo que el papa promete, y cuando el
//  sincronizador los recorre a todos por igual se nos cae todo.
//
//  Para correrlo:  node lsp_viola_lsp.js
// ============================================================

console.log("=".repeat(60));
console.log("  [MAL] DISENO QUE VIOLA EL LSP");
console.log("=".repeat(60));
console.log();


// ------------------------------------------------------------
//  El papa promete dos cosas: que trae pedidos de una API y que
//  puede marcarlos como facturados alla afuera.
// ------------------------------------------------------------
class Marketplace {
  constructor(nombre) {
    this.nombre = nombre;
  }

  // Promesa: siempre devuelve un arreglo de pedidos
  sincronizarPedidos() {
    return [];
  }

  // Promesa: recibe un pedido y lo marca facturado. Devuelve true
  marcarComoFacturado(pedido) {
    return true;
  }
}


class VtexMarketplace extends Marketplace {
  constructor() { super("VTEX"); }

  sincronizarPedidos() {
    console.log("  [VTEX]  Bajando pedidos de la API...");
    return [
      { id: "V-1045", cliente: "Carlos Lopez", total: 1850000 },
      { id: "V-1046", cliente: "Maria Torres", total: 920000 }
    ];
  }

  // [MAL] Aqui le pusimos MAS requisitos que el papa. El papa
  // recibia cualquier pedido, este exige que ya traiga el numero
  // de factura y la guia. O sea el hijo es mas exigente que el
  // papa y por eso no lo podemos sustituir tranquilos.
  marcarComoFacturado(pedido) {
    if (!pedido.numeroFactura || !pedido.guia) {
      throw new Error("VTEX necesita numeroFactura y guia para el invoice");
    }
    console.log("  [VTEX]  Pedido " + pedido.id + " marcado como invoiced");
    return true;
  }
}


class AddiMarketplace extends Marketplace {
  constructor() { super("Addi"); }

  sincronizarPedidos() {
    console.log("  [Addi]  Bajando pedidos de la API...");
    return [
      { id: "A-3301", cliente: "Luis Herrera", total: 2100000 }
    ];
  }

  marcarComoFacturado(pedido) {
    console.log("  [Addi]  Pedido " + pedido.id + " marcado como facturado");
    return true;
  }
}


// ------------------------------------------------------------
//  [MAL] Y aqui esta el hijo problematico
//  Los pedidos manuales los monta el asesor en la sede, no
//  vienen de ninguna API. Entonces heredamos de Marketplace
//  pero no podemos cumplir lo que el papa prometio.
// ------------------------------------------------------------
class PedidosManuales extends Marketplace {
  constructor() { super("Manuales"); }

  // [MAL] El papa prometia devolver un arreglo y este revienta.
  // Cualquier codigo que confie en el papa se nos cae aqui.
  sincronizarPedidos() {
    throw new Error("Los pedidos manuales no tienen API que sincronizar");
  }

  // [MAL] Y este otro no revienta pero devuelve otra cosa
  // (un texto en vez del true que promete el papa).
  marcarComoFacturado(pedido) {
    return "no aplica";
  }
}


// ------------------------------------------------------------
//  El sincronizador: el pobre solo conoce al papa Marketplace
// ------------------------------------------------------------
function sincronizarTodo(origenes) {
  let todos = [];
  for (const origen of origenes) {
    console.log("  [Sync]  Revisando " + origen.nombre + "...");
    const pedidos = origen.sincronizarPedidos();
    todos = todos.concat(pedidos);
  }
  return todos;
}


// ============================================================
//  USO: aqui se ve el problema
// ============================================================
const origenes = [new VtexMarketplace(), new AddiMarketplace(), new PedidosManuales()];

console.log("--- Intento 1: sincronizar todos los origenes ---");
console.log();
try {
  const pedidos = sincronizarTodo(origenes);
  console.log("  Bajamos " + pedidos.length + " pedidos");
} catch (e) {
  console.log("  [Error]  " + e.message);
  console.log("  Se nos cayo TODA la sincronizacion por culpa de un hijo,");
  console.log("  y ojo que VTEX y Addi si habian traido sus pedidos.");
}
console.log();


console.log("--- Intento 2: el parche feo que uno termina haciendo ---");
console.log();
// [MAL] Cuando toca preguntar de que tipo es cada objeto para no
// reventar, esa es la senal de que rompimos Liskov. Y de paso
// tambien rompimos el OCP, porque cada hijo raro que entre nos
// obliga a venir a meterle otro if a esta funcion.
let total = [];
for (const origen of origenes) {
  if (origen instanceof PedidosManuales) {
    console.log("  [Sync]  A " + origen.nombre + " toca saltarlo a la brava");
    continue;
  }
  total = total.concat(origen.sincronizarPedidos());
}
console.log("  Bajamos " + total.length + " pedidos (dejando uno por fuera)");
console.log();


console.log("--- Intento 3: facturar un pedido cualquiera ---");
console.log();
const pedido = { id: "V-1045", cliente: "Carlos Lopez", total: 1850000 };
try {
  new VtexMarketplace().marcarComoFacturado(pedido);
} catch (e) {
  console.log("  [Error]  " + e.message);
  console.log("  El papa recibia cualquier pedido, el hijo pide mas cosas.");
}
console.log();


console.log("=".repeat(60));
console.log("  CONCLUSION");
console.log("=".repeat(60));
console.log();
console.log("  - PedidosManuales revienta donde el papa no revienta");
console.log("  - PedidosManuales devuelve un texto donde el papa da true");
console.log("  - VtexMarketplace exige mas datos que el papa");
console.log("  - Nos toco meter instanceof para que no se cayera");
console.log();
console.log("  El hijo no puede reemplazar al papa -> VIOLA LSP");
console.log();
