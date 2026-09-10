// ============================================================
//  PRINCIPIO ABIERTO / CERRADO (OCP) - SOLID
//  Contexto: Generacion de guias de envio - IS-III FI303290
//  PARTE 1: DISENO QUE VIOLA EL OCP
// ============================================================
//
//  El OCP dice que el codigo deberia quedar ABIERTO para
//  extenderlo y CERRADO para modificarlo. O sea, si entra algo
//  nuevo lo agregamos aparte y no le metemos mano a lo que ya
//  esta funcionando.
//
//  Aca hacemos justo lo contrario: metimos todas las
//  transportadoras dentro de una sola clase llena de if, asi que
//  cada vez que entra una nueva nos toca volver a abrir esta
//  clase. Y de remate el mismo if lo tenemos repetido en los
//  tres metodos.
//
//  Para correrlo:  node ocp_viola_ocp.js
// ============================================================

console.log("=".repeat(60));
console.log("  [MAL] DISENO QUE VIOLA EL OCP");
console.log("=".repeat(60));
console.log();


class GeneradorDeGuias_MAL {

  // --- Metodo 1: el if que nunca se acaba ---
  generarGuia(pedido, transportadora) {
    if (transportadora === "coordinadora") {
      console.log("  [Coordinadora]  Armando el XML del SOAP...");
      console.log("  [Coordinadora]  Guia 900" + pedido.id + " lista");
      return "900" + pedido.id;
    }
    else if (transportadora === "servientrega") {
      console.log("  [Servientrega]  Llamando el REST de guias...");
      console.log("  [Servientrega]  Guia SER-" + pedido.id + " lista");
      return "SER-" + pedido.id;
    }
    // [MAL] Este de aca lo tuvimos que agregar despues, o sea nos
    // toco volver a abrir una clase que ya estaba andando bien.
    // Eso es exactamente lo que el OCP no quiere.
    else if (transportadora === "skydropx") {
      console.log("  [Skydropx]  Pidiendo el token OAuth...");
      console.log("  [Skydropx]  Guia SKY-" + pedido.id + " lista");
      return "SKY-" + pedido.id;
    }
    else {
      throw new Error("No conocemos esa transportadora: " + transportadora);
    }
  }

  // --- Metodo 2: y aca el MISMO if otra vez ---
  cotizarFlete(pedido, transportadora) {
    if (transportadora === "coordinadora") {
      return 12000 + pedido.peso * 900;
    }
    else if (transportadora === "servientrega") {
      return 14500 + pedido.peso * 750;
    }
    else if (transportadora === "skydropx") {
      return 11800 + pedido.peso * 1000;
    }
    else {
      throw new Error("No conocemos esa transportadora: " + transportadora);
    }
  }

  // --- Metodo 3: y aca de nuevo, tercera vez ---
  rastrear(numeroGuia, transportadora) {
    if (transportadora === "coordinadora") {
      console.log("  [Coordinadora]  Estado de " + numeroGuia + ": EN REPARTO");
    }
    else if (transportadora === "servientrega") {
      console.log("  [Servientrega]  Estado de " + numeroGuia + ": EN BODEGA");
    }
    else if (transportadora === "skydropx") {
      console.log("  [Skydropx]  Estado de " + numeroGuia + ": RECOGIDO");
    }
    else {
      throw new Error("No conocemos esa transportadora: " + transportadora);
    }
  }
}


// ------------------------------------------------------------
//  Uso del diseno que viola el OCP
// ------------------------------------------------------------
const pedido = { id: "1045", cliente: "Carlos Lopez", ciudad: "Pasto", peso: 2 };
const generador = new GeneradorDeGuias_MAL();

console.log("--- Pedido " + pedido.id + " con Coordinadora ---");
const guia1 = generador.generarGuia(pedido, "coordinadora");
console.log("  Flete: $" + generador.cotizarFlete(pedido, "coordinadora"));
generador.rastrear(guia1, "coordinadora");
console.log();

console.log("--- El mismo pedido pero con Skydropx ---");
const guia2 = generador.generarGuia(pedido, "skydropx");
console.log("  Flete: $" + generador.cotizarFlete(pedido, "skydropx"));
generador.rastrear(guia2, "skydropx");
console.log();

// [MAL] Y si el cliente nos pide Interrapidisimo, nos toca entrar
// a los TRES metodos de arriba a meterle otro else if a cada uno.
console.log("--- Nos piden Interrapidisimo ---");
try {
  generador.generarGuia(pedido, "interrapidisimo");
} catch (e) {
  console.log("  [Error]  " + e.message);
  console.log("  Nos toca abrir la clase otra vez para que sirva.");
}
console.log();


console.log("=".repeat(60));
console.log("  CONCLUSION");
console.log("=".repeat(60));
console.log();
console.log("  - Transportadora nueva  -> hay que modificar la clase");
console.log("  - El mismo if repetido  -> si se nos pasa uno, ahi queda el bug");
console.log("  - Cada cambio nos obliga a volver a probar lo que ya servia");
console.log();
console.log("  Para extender toca MODIFICAR -> VIOLA OCP");
console.log();
