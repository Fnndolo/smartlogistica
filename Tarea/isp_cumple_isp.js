// ============================================================
//  PRINCIPIO DE SEGREGACION DE INTERFACES (ISP) - SOLID
//  Contexto: Conexiones con terceros - IS-III FI303290
//  PARTE 2: DISENO QUE CUMPLE EL ISP
// ============================================================
//
//  En vez de una interfaz gorda con todo adentro, la partimos en
//  cuatro chiquitas, una por cada cosa que se hace:
//
//    FuenteDePedidos  -> el que sabe traer pedidos
//    Transportadora   -> el que sabe hacer guias y rotulos
//    Facturador       -> el que sabe emitir facturas
//    CanalDeMensajes  -> el que sabe mandar mensajes
//
//  Asi cada conexion implementa solo lo que de verdad hace y no
//  le queda ni un metodo de relleno. Y el que las usa pide la
//  interfaz chiquita que necesita, no la conexion completa.
//
//  Ojo con algo de JS: aca solo se hereda de una clase, entonces
//  cuando una conexion cumple dos contratos (como VTEX, que trae
//  pedidos y ademas recibe la factura) heredamos de uno y el otro
//  lo cumplimos poniendo los metodos. Por eso dejamos la funcion
//  cumpleCon(), para verificar que si tenga lo que promete.
//
//  Para correrlo:  node isp_cumple_isp.js
// ============================================================

console.log("=".repeat(60));
console.log("  [OK] DISENO QUE CUMPLE EL ISP");
console.log("=".repeat(60));
console.log();


// ------------------------------------------------------------
//  Las cuatro interfaces chiquitas
// ------------------------------------------------------------
class FuenteDePedidos {
  descargarPedidos() { throw new Error("Toca implementar descargarPedidos()"); }
}

class Transportadora {
  generarGuia(pedido) { throw new Error("Toca implementar generarGuia()"); }
  imprimirRotulo(guia) { throw new Error("Toca implementar imprimirRotulo()"); }
}

class Facturador {
  emitirFactura(pedido) { throw new Error("Toca implementar emitirFactura()"); }
}

class CanalDeMensajes {
  enviarMensaje(telefono, texto) { throw new Error("Toca implementar enviarMensaje()"); }
}

// Para saber si algo cumple un contrato sin andar preguntando
// de que clase es. Le pasamos la lista de metodos y listo.
function cumpleCon(objeto, metodos) {
  return metodos.every(m => typeof objeto[m] === "function");
}


// ------------------------------------------------------------
//  Coordinadora: solo transportadora, y ya. Dos metodos, cero
//  relleno. No le tuvimos que escribir ni un "no hago eso".
// ------------------------------------------------------------
class ConexionCoordinadora extends Transportadora {
  constructor() { super(); this.nombre = "Coordinadora"; }

  generarGuia(pedido) {
    console.log("  [Coordinadora]  Guia 900" + pedido.id + " generada");
    return "900" + pedido.id;
  }
  imprimirRotulo(guia) {
    console.log("  [Coordinadora]  Rotulo de la guia " + guia + " en PDF");
    return "rotulo.pdf";
  }
}


// ------------------------------------------------------------
//  Alegra: solo facturador. Un metodo y nada mas.
// ------------------------------------------------------------
class ConexionAlegra extends Facturador {
  constructor() { super(); this.nombre = "Alegra"; }

  emitirFactura(pedido) {
    console.log("  [Alegra]  Factura PAS-4412 del pedido " + pedido.id);
    return "PAS-4412";
  }
}


// ------------------------------------------------------------
//  Whapify: solo canal de mensajes
// ------------------------------------------------------------
class ConexionWhapify extends CanalDeMensajes {
  constructor() { super(); this.nombre = "Whapify"; }

  enviarMensaje(telefono, texto) {
    console.log("  [Whapify]  A " + telefono + ": " + texto);
    return true;
  }
}


// ------------------------------------------------------------
//  VTEX: esta si hace dos cosas, trae los pedidos y despues le
//  avisamos que ya facturamos. Entonces cumple dos contratos,
//  pero solo esos dos, no los cuatro.
// ------------------------------------------------------------
class ConexionVtex extends FuenteDePedidos {
  constructor() { super(); this.nombre = "VTEX"; }

  descargarPedidos() {
    console.log("  [VTEX]  Bajando pedidos de la API...");
    return [
      { id: "1045", cliente: "Carlos Lopez", telefono: "3001234567" },
      { id: "1046", cliente: "Maria Torres", telefono: "3109876543" }
    ];
  }

  // Este es el de Facturador. No heredamos de esa clase porque en
  // JS no se puede heredar de dos, pero el contrato si lo cumple.
  emitirFactura(pedido) {
    console.log("  [VTEX]  Pedido " + pedido.id + " marcado como invoiced");
    return true;
  }
}


// ------------------------------------------------------------
//  Los servicios: cada uno pide SOLO la interfaz que necesita.
//  El de envios no sabe que existe Alegra ni Whapify.
// ------------------------------------------------------------
class ServicioDeEnvios {
  despachar(pedido, transportadora) {
    const guia = transportadora.generarGuia(pedido);
    transportadora.imprimirRotulo(guia);
    return guia;
  }
}

class ServicioDeFacturacion {
  facturar(pedido, facturador) {
    return facturador.emitirFactura(pedido);
  }
}

class ServicioDeAvisos {
  avisarAlCliente(pedido, guia, canal) {
    return canal.enviarMensaje(
      pedido.telefono,
      "Hola " + pedido.cliente + ", tu pedido salio con la guia " + guia
    );
  }
}


// ============================================================
//  USO
// ============================================================
const vtex         = new ConexionVtex();
const coordinadora = new ConexionCoordinadora();
const alegra       = new ConexionAlegra();
const whapify      = new ConexionWhapify();

console.log("--- Flujo 1: el pedido completo, cada uno en lo suyo ---");
console.log();
const pedidos = vtex.descargarPedidos();
const pedido  = pedidos[0];

const factura = new ServicioDeFacturacion().facturar(pedido, alegra);
const guia    = new ServicioDeEnvios().despachar(pedido, coordinadora);
new ServicioDeAvisos().avisarAlCliente(pedido, guia, whapify);
vtex.emitirFactura(pedido);
console.log();


console.log("--- Flujo 2: cambiamos quien factura y nada mas se mueve ---");
console.log();
// [OK] Como el servicio solo pide un Facturador, le podemos meter
// cualquiera. Aca entra uno nuevo sin tocar nada de lo de arriba.
class ConexionSiigo extends Facturador {
  constructor() { super(); this.nombre = "Siigo"; }
  emitirFactura(pedido) {
    console.log("  [Siigo]  Factura SIG-0091 del pedido " + pedido.id);
    return "SIG-0091";
  }
}
new ServicioDeFacturacion().facturar(pedido, new ConexionSiigo());
console.log();


console.log("--- Flujo 3: el panel revisando que sabe hacer cada uno ---");
console.log();
// [OK] Ya no toca probar a ver si revienta. Preguntamos por el
// contrato y sabemos que puede hacer cada conexion.
const conexiones = [vtex, coordinadora, alegra, whapify];
for (const c of conexiones) {
  const sabe = [];
  if (cumpleCon(c, ["descargarPedidos"]))              sabe.push("trae pedidos");
  if (cumpleCon(c, ["generarGuia", "imprimirRotulo"])) sabe.push("hace guias");
  if (cumpleCon(c, ["emitirFactura"]))                 sabe.push("factura");
  if (cumpleCon(c, ["enviarMensaje"]))                 sabe.push("manda mensajes");
  console.log("  " + c.nombre + " -> " + sabe.join(", "));
}
console.log();


console.log("=".repeat(60));
console.log("  CONCLUSION");
console.log("=".repeat(60));
console.log();
console.log("  Conexion      | Contratos que cumple      | Relleno");
console.log("  " + "-".repeat(57));
console.log("  Coordinadora  | Transportadora            | 0 metodos");
console.log("  Alegra        | Facturador                | 0 metodos");
console.log("  Whapify       | CanalDeMensajes           | 0 metodos");
console.log("  VTEX          | FuenteDePedidos + Factur. | 0 metodos");
console.log();
console.log("  Nadie carga metodos que no usa -> ISP cumplido [OK]");
console.log();
