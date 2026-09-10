// ============================================================
//  PRINCIPIO DE INVERSION DE DEPENDENCIAS (DIP) - SOLID
//  Contexto: Facturacion de un pedido - IS-III FI303290
//  PARTE 2: DISENO QUE CUMPLE EL DIP
// ============================================================
//
//  Lo que cambiamos: el servicio ya no hace el new de nada. Ahora
//  le pasamos por el constructor un facturador, un repositorio y
//  un notificador, y el solo sabe pedirles cosas.
//
//  Ninguno de los dos lados depende del otro:
//    - El servicio depende de las abstracciones (Facturador...)
//    - Alegra, Postgres y Whapify tambien dependen de ellas
//
//  El que arma todo es el de mas abajo (lo que seria el main o el
//  modulo de la app). Ahi es donde decidimos que herramientas van.
//
//  Lo mejor de esto es que podemos correr el mismo servicio con
//  herramientas de mentiras y probarlo sin gastar una factura de
//  verdad ni mandarle WhatsApp a un cliente real.
//
//  Para correrlo:  node dip_cumple_dip.js
// ============================================================

console.log("=".repeat(60));
console.log("  [OK] DISENO QUE CUMPLE EL DIP");
console.log("=".repeat(60));
console.log();


// ------------------------------------------------------------
//  Las abstracciones: lo unico que el servicio va a conocer
// ------------------------------------------------------------
class Facturador {
  crearFactura(pedido) { throw new Error("Toca implementar crearFactura()"); }
}

class RepositorioDePedidos {
  guardarFactura(pedido, factura) { throw new Error("Toca implementar guardarFactura()"); }
}

class Notificador {
  avisar(telefono, texto) { throw new Error("Toca implementar avisar()"); }
}


// ------------------------------------------------------------
//  Las herramientas de verdad, cada una cumpliendo lo suyo
// ------------------------------------------------------------
class FacturadorAlegra extends Facturador {
  constructor(token) { super(); this.token = token; }

  crearFactura(pedido) {
    console.log("  [Alegra]  POST /invoices del pedido " + pedido.id);
    return { numero: "PAS-4412", total: pedido.total };
  }
}

class RepositorioPostgres extends RepositorioDePedidos {
  guardarFactura(pedido, factura) {
    console.log("  [Postgres]  UPDATE pedidos SET factura='"
                + factura.numero + "' WHERE id='" + pedido.id + "'");
  }
}

class NotificadorWhapify extends Notificador {
  constructor(token) { super(); this.token = token; }

  avisar(telefono, texto) {
    console.log("  [Whapify]  A " + telefono + ": " + texto);
    return true;
  }
}


// ------------------------------------------------------------
//  [OK] El servicio: fijese que aqui adentro no hay un solo new
//  ni se nombra a Alegra, a Postgres ni a Whapify. Solo pide lo
//  que necesita y lo usa.
// ------------------------------------------------------------
class ServicioDeFacturacion {

  constructor(facturador, repositorio, notificador) {
    this.facturador  = facturador;
    this.repositorio = repositorio;
    this.notificador = notificador;
  }

  facturar(pedido) {
    console.log("  [Servicio]  Facturando el pedido " + pedido.id + "...");

    const factura = this.facturador.crearFactura(pedido);
    this.repositorio.guardarFactura(pedido, factura);
    this.notificador.avisar(
      pedido.telefono,
      "Hola " + pedido.cliente + ", tu factura es la " + factura.numero
    );

    return factura;
  }
}


// ------------------------------------------------------------
//  Las de mentiras, para probar sin tocar nada real
// ------------------------------------------------------------
class FacturadorDePrueba extends Facturador {
  crearFactura(pedido) {
    console.log("  [Prueba]  Factura falsa, no se le pego a Alegra");
    return { numero: "TEST-0001", total: pedido.total };
  }
}

class RepositorioEnMemoria extends RepositorioDePedidos {
  constructor() { super(); this.guardados = []; }

  guardarFactura(pedido, factura) {
    this.guardados.push({ pedido: pedido.id, factura: factura.numero });
    console.log("  [Prueba]  Guardado en memoria, sin base de datos");
  }
}

class NotificadorQueNoManda extends Notificador {
  avisar(telefono, texto) {
    console.log("  [Prueba]  Mensaje NO enviado (asi no molestamos al cliente)");
    return true;
  }
}


// ============================================================
//  USO: aca es donde se arma todo (esto seria el main)
// ============================================================
const pedido = {
  id: "1045",
  cliente: "Carlos Lopez",
  telefono: "3001234567",
  total: 1850000
};

console.log("--- Flujo 1: montaje de produccion ---");
console.log();
const enProduccion = new ServicioDeFacturacion(
  new FacturadorAlegra("token-de-produccion-123"),
  new RepositorioPostgres(),
  new NotificadorWhapify("token-whapify-abc")
);
enProduccion.facturar(pedido);
console.log();


console.log("--- Flujo 2: el MISMO servicio, pero para probar ---");
console.log();
// [OK] Aqui esta la ganancia. Es la misma clase ServicioDeFacturacion
// de arriba, ni una linea distinta, solo le cambiamos con que la
// armamos. Nada de esto toca Alegra, ni la BD, ni el WhatsApp.
const memoria = new RepositorioEnMemoria();
const enPruebas = new ServicioDeFacturacion(
  new FacturadorDePrueba(),
  memoria,
  new NotificadorQueNoManda()
);
const facturaFalsa = enPruebas.facturar(pedido);
console.log();
console.log("  Lo que quedo guardado: " + JSON.stringify(memoria.guardados));
console.log("  Factura de prueba: " + facturaFalsa.numero);
console.log();


console.log("--- Flujo 3: nos cambiamos a Siigo ---");
console.log();
// [OK] Cambiar de facturador ya no nos obliga a tocar el servicio.
// Agregamos la clase nueva y la metemos en el montaje, listo.
class FacturadorSiigo extends Facturador {
  crearFactura(pedido) {
    console.log("  [Siigo]  Factura SIG-0091 del pedido " + pedido.id);
    return { numero: "SIG-0091", total: pedido.total };
  }
}

const conSiigo = new ServicioDeFacturacion(
  new FacturadorSiigo(),
  new RepositorioPostgres(),
  new NotificadorWhapify("token-whapify-abc")
);
conSiigo.facturar(pedido);
console.log();


console.log("=".repeat(60));
console.log("  CONCLUSION");
console.log("=".repeat(60));
console.log();
console.log("  Quien                   | De que depende");
console.log("  " + "-".repeat(57));
console.log("  ServicioDeFacturacion   | De las abstracciones, nada mas");
console.log("  FacturadorAlegra        | De la abstraccion Facturador");
console.log("  RepositorioPostgres     | De RepositorioDePedidos");
console.log("  NotificadorWhapify      | De Notificador");
console.log("  El montaje (main)       | De todos, y por eso los arma el");
console.log();
console.log("  Los dos lados dependen de la abstraccion -> DIP cumplido [OK]");
console.log();
