// ============================================================
//  PRINCIPIO DE INVERSION DE DEPENDENCIAS (DIP) - SOLID
//  Contexto: Facturacion de un pedido - IS-III FI303290
//  PARTE 1: DISENO QUE VIOLA EL DIP
// ============================================================
//
//  El DIP dice que lo de arriba (la logica del negocio) no
//  deberia depender de lo de abajo (Alegra, Postgres, Whapify).
//  Los dos deberian depender de una abstraccion.
//
//  Aca pasa lo contrario: el servicio de facturacion, que es
//  nuestra logica, se amarro el mismo a las tres herramientas.
//  Adentro del constructor hace el new de cada una, entonces
//  quedaron pegadas con soldadura.
//
//  Eso nos trae dos dolores de cabeza:
//    - Para cambiar Alegra por Siigo toca meterle mano al servicio
//    - Para probarlo toca pegarle de verdad a Alegra y a la BD
//
//  Para correrlo:  node dip_viola_dip.js
// ============================================================

console.log("=".repeat(60));
console.log("  [MAL] DISENO QUE VIOLA EL DIP");
console.log("=".repeat(60));
console.log();


// ------------------------------------------------------------
//  Los detalles: las herramientas concretas
// ------------------------------------------------------------
class AlegraApi {
  constructor(token) {
    this.token = token;
    console.log("  [Alegra]  Conectando con el token " + token + "...");
  }
  crearFactura(pedido) {
    console.log("  [Alegra]  POST /invoices del pedido " + pedido.id);
    return { numero: "PAS-4412", total: pedido.total };
  }
}

class RepositorioPostgres {
  constructor() {
    console.log("  [Postgres]  Abriendo conexion a la base de datos...");
  }
  guardarFactura(pedido, factura) {
    console.log("  [Postgres]  UPDATE pedidos SET factura='"
                + factura.numero + "' WHERE id='" + pedido.id + "'");
  }
}

class WhapifyApi {
  constructor(token) {
    console.log("  [Whapify]  Cargando el X-ACCESS-TOKEN...");
  }
  enviarTexto(telefono, texto) {
    console.log("  [Whapify]  A " + telefono + ": " + texto);
  }
}


// ------------------------------------------------------------
//  [MAL] El servicio, que es lo de arriba, haciendo el new de
//  todo lo de abajo. Aqui es donde se rompe el principio.
// ------------------------------------------------------------
class ServicioDeFacturacion_MAL {

  constructor() {
    // [MAL] El servicio decide con que herramientas trabaja y
    // hasta se trae el token quemado aqui adentro. Desde este
    // momento ya no lo podemos separar de Alegra ni de Postgres.
    this.alegra  = new AlegraApi("token-de-produccion-123");
    this.bd      = new RepositorioPostgres();
    this.whapify = new WhapifyApi("token-whapify-abc");
  }

  facturar(pedido) {
    console.log("  [Servicio]  Facturando el pedido " + pedido.id + "...");

    const factura = this.alegra.crearFactura(pedido);
    this.bd.guardarFactura(pedido, factura);
    this.whapify.enviarTexto(
      pedido.telefono,
      "Hola " + pedido.cliente + ", tu factura es la " + factura.numero
    );

    return factura;
  }
}


// ============================================================
//  USO: aqui se ve el problema
// ============================================================
const pedido = {
  id: "1045",
  cliente: "Carlos Lopez",
  telefono: "3001234567",
  total: 1850000
};

console.log("--- Flujo 1: facturar normal ---");
console.log();
const servicio = new ServicioDeFacturacion_MAL();
servicio.facturar(pedido);
console.log();


console.log("--- Flujo 2: intentar probarlo ---");
console.log();
// [MAL] Cada vez que hacemos un new del servicio, asi sea para
// una prueba boba, se conecta a Alegra de verdad, abre la base
// de datos y le manda WhatsApp al cliente. O sea que probar nos
// puede costar una factura de mentiras en la contabilidad y un
// mensaje al celular de un cliente real.
console.log("  Solo por crear el servicio ya se conecto a todo:");
const servicioDePrueba = new ServicioDeFacturacion_MAL();
console.log("  ...y ni siquiera hemos llamado facturar() todavia.");
console.log();


console.log("--- Flujo 3: nos cambiamos a Siigo ---");
console.log();
console.log("  Como el new AlegraApi() esta quemado adentro del");
console.log("  servicio, toca entrar a modificar el servicio para");
console.log("  cambiar de facturador. Y el servicio no tendria por");
console.log("  que enterarse de con quien facturamos.");
console.log();


console.log("=".repeat(60));
console.log("  CONCLUSION");
console.log("=".repeat(60));
console.log();
console.log("  - El servicio hace el new de sus tres herramientas");
console.log("  - No lo podemos probar sin pegarle a los servicios reales");
console.log("  - Para cambiar Alegra por Siigo toca modificar el servicio");
console.log("  - El token quemado adentro, de una vez");
console.log();
console.log("  Lo de arriba depende de lo de abajo -> VIOLA DIP");
console.log();
