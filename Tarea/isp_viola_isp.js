// ============================================================
//  PRINCIPIO DE SEGREGACION DE INTERFACES (ISP) - SOLID
//  Contexto: Conexiones con terceros - IS-III FI303290
//  PARTE 1: DISENO QUE VIOLA EL ISP
// ============================================================
//
//  El ISP dice que a nadie se le debe obligar a implementar
//  metodos que no va a usar. Mejor varias interfaces chiquitas
//  que una sola gorda.
//
//  Aca cometimos el error de hacer UNA sola interfaz gigante
//  llamada Conexion, con todo lo que hace el sistema: bajar
//  pedidos, generar guias, imprimir rotulos, facturar, mandar
//  WhatsApp y subir archivos.
//
//  El problema es que Coordinadora solo hace guias, Alegra solo
//  facturas y Whapify solo mensajes, pero a todas les toca
//  implementar los seis metodos aunque sea para decir "yo no
//  hago eso". Puro relleno.
//
//  Para correrlo:  node isp_viola_isp.js
// ============================================================

console.log("=".repeat(60));
console.log("  [MAL] DISENO QUE VIOLA EL ISP");
console.log("=".repeat(60));
console.log();


// ------------------------------------------------------------
//  [MAL] La interfaz gorda: todo metido en el mismo saco
// ------------------------------------------------------------
class Conexion {
  descargarPedidos()          { throw new Error("Sin implementar"); }
  generarGuia(pedido)         { throw new Error("Sin implementar"); }
  imprimirRotulo(guia)        { throw new Error("Sin implementar"); }
  emitirFactura(pedido)       { throw new Error("Sin implementar"); }
  enviarWhatsapp(tel, texto)  { throw new Error("Sin implementar"); }
  subirArchivo(archivo)       { throw new Error("Sin implementar"); }
}


// ------------------------------------------------------------
//  Coordinadora: de seis metodos solo le sirven dos
// ------------------------------------------------------------
class ConexionCoordinadora extends Conexion {
  constructor() { super(); this.nombre = "Coordinadora"; }

  generarGuia(pedido) {
    console.log("  [Coordinadora]  Guia 900" + pedido.id + " generada");
    return "900" + pedido.id;
  }
  imprimirRotulo(guia) {
    console.log("  [Coordinadora]  Rotulo de la guia " + guia + " en PDF");
    return "rotulo.pdf";
  }

  // [MAL] Todo esto de aca abajo es relleno. Coordinadora no baja
  // pedidos, no factura, no manda WhatsApp y no sube archivos,
  // pero igual nos toca escribirlo porque la interfaz lo exige.
  descargarPedidos()         { throw new Error("Coordinadora no baja pedidos"); }
  emitirFactura(pedido)      { throw new Error("Coordinadora no factura"); }
  enviarWhatsapp(tel, texto) { throw new Error("Coordinadora no manda WhatsApp"); }
  subirArchivo(archivo)      { throw new Error("Coordinadora no guarda archivos"); }
}


// ------------------------------------------------------------
//  Alegra: solo factura, y le tocan cinco metodos de relleno
// ------------------------------------------------------------
class ConexionAlegra extends Conexion {
  constructor() { super(); this.nombre = "Alegra"; }

  emitirFactura(pedido) {
    console.log("  [Alegra]  Factura PAS-4412 del pedido " + pedido.id);
    return "PAS-4412";
  }

  // [MAL] Cinco metodos que no hacen nada. Y el que peor se porta
  // es este de abajo, que en vez de reventar devuelve vacio y nos
  // deja creyendo que si bajo pedidos. Ese es de los que nos rompen
  // datos y despues uno no entiende que paso.
  descargarPedidos()         { return []; }
  generarGuia(pedido)        { throw new Error("Alegra no genera guias"); }
  imprimirRotulo(guia)       { throw new Error("Alegra no imprime rotulos"); }
  enviarWhatsapp(tel, texto) { throw new Error("Alegra no manda WhatsApp"); }
  subirArchivo(archivo)      { throw new Error("Alegra no guarda archivos"); }
}


// ------------------------------------------------------------
//  Whapify: solo manda mensajes, cinco de relleno tambien
// ------------------------------------------------------------
class ConexionWhapify extends Conexion {
  constructor() { super(); this.nombre = "Whapify"; }

  enviarWhatsapp(telefono, texto) {
    console.log("  [Whapify]  A " + telefono + ": " + texto);
    return true;
  }

  descargarPedidos()    { throw new Error("Whapify no baja pedidos"); }
  generarGuia(pedido)   { throw new Error("Whapify no genera guias"); }
  imprimirRotulo(guia)  { throw new Error("Whapify no imprime rotulos"); }
  emitirFactura(pedido) { throw new Error("Whapify no factura"); }
  subirArchivo(archivo) { throw new Error("Whapify no guarda archivos"); }
}


// ------------------------------------------------------------
//  El panel de conexiones, que sufre con este diseno
// ------------------------------------------------------------
function probarConexiones(conexiones) {
  const pedido = { id: "1045", cliente: "Carlos Lopez" };

  for (const c of conexiones) {
    console.log("  [Panel]  Probando " + c.nombre + "...");
    // [MAL] Como todas dicen ser una Conexion, no tenemos como
    // saber que sirve y que no, sino probando a ver si revienta.
    try {
      c.generarGuia(pedido);
    } catch (e) {
      console.log("    x " + e.message);
    }
    try {
      c.emitirFactura(pedido);
    } catch (e) {
      console.log("    x " + e.message);
    }
  }
}


// ============================================================
//  USO: aqui se ve el problema
// ============================================================
console.log("--- Flujo 1: el panel probando las conexiones ---");
console.log();
probarConexiones([
  new ConexionCoordinadora(),
  new ConexionAlegra(),
  new ConexionWhapify()
]);
console.log();


console.log("--- Flujo 2: lo peligroso del metodo que no revienta ---");
console.log();
const alegra = new ConexionAlegra();
const traidos = alegra.descargarPedidos();
console.log("  Alegra nos devolvio " + traidos.length + " pedidos");
console.log("  Y ahi vamos a creer que Alegra si baja pedidos y que");
console.log("  simplemente no habia ninguno. Puro engano.");
console.log();


console.log("--- Flujo 3: cuando toca meterle un metodo mas ---");
console.log();
console.log("  Si le agregamos rastrearGuia() a la interfaz Conexion,");
console.log("  nos toca ir a las TRES clases a escribirlo, cuando la");
console.log("  unica que de verdad lo necesita es Coordinadora.");
console.log();


console.log("=".repeat(60));
console.log("  CONCLUSION");
console.log("=".repeat(60));
console.log();
console.log("  Conexion      | Metodos que usa | Metodos de relleno");
console.log("  " + "-".repeat(57));
console.log("  Coordinadora  | 2               | 4");
console.log("  Alegra        | 1               | 5");
console.log("  Whapify       | 1               | 5");
console.log();
console.log("  Todos cargando metodos que no usan -> VIOLA ISP");
console.log();
