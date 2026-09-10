// ============================================================
//  PRINCIPIO DE SUSTITUCION DE LISKOV (LSP) - SOLID
//  Contexto: Origenes de pedidos (marketplaces) - IS-III FI303290
//  PARTE 2: DISENO QUE CUMPLE EL LSP
// ============================================================
//
//  Lo que corregimos: en vez de prometer "sincronizar contra una
//  API" (que los pedidos manuales no pueden cumplir), el papa
//  ahora promete algo que TODOS si podemos cumplir de verdad:
//  "entregame los pedidos pendientes". De donde los saque cada
//  uno ya es problema de cada uno.
//
//  Las reglas que nos pusimos para no romper Liskov:
//    1. No pedir mas requisitos que el papa
//    2. Devolver lo mismo que promete el papa (siempre un arreglo)
//    3. No reventar donde el papa no revienta
//
//  El resultado se nota solo: en el sincronizador no quedo ni un
//  instanceof ni un if preguntando quien es quien.
//
//  Para correrlo:  node lsp_cumple_lsp.js
// ============================================================

console.log("=".repeat(60));
console.log("  [OK] DISENO QUE CUMPLE EL LSP");
console.log("=".repeat(60));
console.log();


// ------------------------------------------------------------
//  El contrato, pero esta vez uno que todos podamos cumplir
// ------------------------------------------------------------
class OrigenDePedidos {
  constructor(nombre) {
    this.nombre = nombre;
  }

  // Promesa 1: devuelve un arreglo de pedidos. Si no hay, va
  // vacio, pero arreglo siempre. Nunca revienta.
  obtenerPedidosPendientes() {
    return [];
  }

  // Promesa 2: recibe un pedido y lo deja marcado como
  // facturado donde le corresponda. Devuelve true o false.
  marcarComoFacturado(pedido) {
    return true;
  }
}


// ------------------------------------------------------------
//  VTEX: los saca de la API del marketplace
// ------------------------------------------------------------
class VtexMarketplace extends OrigenDePedidos {
  constructor() { super("VTEX"); }

  obtenerPedidosPendientes() {
    console.log("  [VTEX]  Bajando pedidos de la API...");
    return [
      { id: "V-1045", cliente: "Carlos Lopez", total: 1850000 },
      { id: "V-1046", cliente: "Maria Torres", total: 920000 }
    ];
  }

  // Recibe cualquier pedido, igual que el papa. Si le faltan
  // datos no reventamos, devolvemos false y seguimos.
  marcarComoFacturado(pedido) {
    if (!pedido.numeroFactura || !pedido.guia) {
      console.log("  [VTEX]  " + pedido.id
                  + " todavia no tiene factura o guia, lo dejamos quieto");
      return false;
    }
    console.log("  [VTEX]  " + pedido.id + " quedo como invoiced");
    return true;
  }
}


// ------------------------------------------------------------
//  Addi: los saca de su propia API
// ------------------------------------------------------------
class AddiMarketplace extends OrigenDePedidos {
  constructor() { super("Addi"); }

  obtenerPedidosPendientes() {
    console.log("  [Addi]  Bajando pedidos de la API...");
    return [
      { id: "A-3301", cliente: "Luis Herrera", total: 2100000 }
    ];
  }

  marcarComoFacturado(pedido) {
    console.log("  [Addi]  " + pedido.id + " quedo como facturado");
    return true;
  }
}


// ------------------------------------------------------------
//  [OK] Los pedidos manuales, que antes eran el problema
//  Ahora si cumplen: no tienen API, pero igual pueden entregar
//  sus pedidos porque los sacan de nuestra base de datos. El
//  sincronizador ni se entera de la diferencia.
// ------------------------------------------------------------
class PedidosManuales extends OrigenDePedidos {
  constructor(baseDeDatos) {
    super("Manuales");
    this.baseDeDatos = baseDeDatos;
  }

  obtenerPedidosPendientes() {
    console.log("  [Manuales]  Leyendo los que monto el asesor en la sede...");
    return this.baseDeDatos;  // siempre arreglo, asi este vacio
  }

  // No hay a quien avisarle afuera, entonces solo lo dejamos
  // marcado en lo nuestro. Devolvemos true igual que el papa.
  marcarComoFacturado(pedido) {
    console.log("  [Manuales]  " + pedido.id + " cerrado como manual_completed");
    return true;
  }
}


// ------------------------------------------------------------
//  El sincronizador: mire que quedo limpio, sin preguntar nada
// ------------------------------------------------------------
function sincronizarTodo(origenes) {
  let todos = [];
  for (const origen of origenes) {
    console.log("  [Sync]  Revisando " + origen.nombre + "...");
    const pedidos = origen.obtenerPedidosPendientes();
    console.log("  [Sync]  " + origen.nombre + " nos dio " + pedidos.length);
    todos = todos.concat(pedidos);
  }
  return todos;
}

function facturarTodos(origen, pedidos) {
  let listos = 0;
  for (const pedido of pedidos) {
    if (origen.marcarComoFacturado(pedido)) {
      listos++;
    }
  }
  return listos;
}


// ============================================================
//  USO
// ============================================================
const manuales = new PedidosManuales([
  { id: "M-0007", cliente: "Ana Rios", total: 1350000 }
]);

const origenes = [new VtexMarketplace(), new AddiMarketplace(), manuales];

console.log("--- Flujo 1: sincronizar todos los origenes ---");
console.log();
const pedidos = sincronizarTodo(origenes);
console.log();
console.log("  Total bajado: " + pedidos.length + " pedidos, sin caidas");
console.log();


console.log("--- Flujo 2: los manuales sin nada pendiente ---");
console.log();
// [OK] Cuando no hay nada devuelve arreglo vacio, no revienta ni
// devuelve null. El que llama no tiene que andar validando raro.
const vacio = new PedidosManuales([]);
console.log("  Nos devolvio: " + JSON.stringify(vacio.obtenerPedidosPendientes()));
console.log();


console.log("--- Flujo 3: marcar como facturado ---");
console.log();
const vtex = new VtexMarketplace();
const listos = facturarTodos(vtex, [
  { id: "V-1045", numeroFactura: "PAS-4412", guia: "9001045" },
  { id: "V-1046" }   // a este le falta factura, pero no nos tumba nada
]);
console.log("  Quedaron facturados: " + listos + " de 2");
console.log();
facturarTodos(manuales, [{ id: "M-0007" }]);
console.log();


console.log("--- Flujo 4: la prueba de fuego del LSP ---");
console.log();
// [OK] Esta funcion solo conoce al papa OrigenDePedidos y le
// pasamos cualquier hijo. Todos responden bien, ninguno revienta.
function cuantosHay(origen) {
  return origen.nombre + " -> " + origen.obtenerPedidosPendientes().length + " pedidos";
}
for (const origen of origenes) {
  console.log("  " + cuantosHay(origen));
}
console.log();


console.log("=".repeat(60));
console.log("  CONCLUSION");
console.log("=".repeat(60));
console.log();
console.log("  Regla del contrato          | Se cumple?");
console.log("  " + "-".repeat(57));
console.log("  No pedir mas que el papa     | Si, todos reciben cualquier pedido");
console.log("  Devolver lo mismo (arreglo)  | Si, aunque vaya vacio");
console.log("  No reventar de mas           | Si, ninguno lanza error");
console.log("  Sin instanceof en el que usa | Si, quedo limpio");
console.log();
console.log("  Cualquier hijo reemplaza al papa -> LSP cumplido [OK]");
console.log();
