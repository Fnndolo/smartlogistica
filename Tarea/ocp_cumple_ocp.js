// ============================================================
//  PRINCIPIO ABIERTO / CERRADO (OCP) - SOLID
//  Contexto: Generacion de guias de envio - IS-III FI303290
//  PARTE 2: DISENO QUE CUMPLE EL OCP
// ============================================================
//
//  Lo que hacemos aca es sacar la parte que cambia (la
//  transportadora) y dejarla detras de una clase base. Cada
//  transportadora es su propia clase y el servicio de envios
//  solo conoce la clase base, ni se entera de con cual esta
//  trabajando.
//
//  Asi, cuando entra una transportadora nueva, nosotros
//  AGREGAMOS una clase y ya. No abrimos nada de lo que ya
//  estaba funcionando.
//
//  En JS no tenemos interfaces como en Java, entonces la clase
//  base nos hace las veces de contrato: dice que metodos toca
//  tener si o si.
//
//  Para correrlo:  node ocp_cumple_ocp.js
// ============================================================

console.log("=".repeat(60));
console.log("  [OK] DISENO QUE CUMPLE EL OCP");
console.log("=".repeat(60));
console.log();


// ------------------------------------------------------------
//  El contrato: lo que toda transportadora nos tiene que dar
// ------------------------------------------------------------
class Transportadora {
  get nombre() {
    throw new Error("Toca ponerle nombre a la transportadora");
  }
  generarGuia(pedido) {
    throw new Error("Toca implementar generarGuia()");
  }
  cotizarFlete(pedido) {
    throw new Error("Toca implementar cotizarFlete()");
  }
  rastrear(numeroGuia) {
    throw new Error("Toca implementar rastrear()");
  }
}


// ------------------------------------------------------------
//  Cada transportadora en lo suyo, sin estorbarle a las otras
// ------------------------------------------------------------
class Coordinadora extends Transportadora {
  get nombre() { return "Coordinadora"; }

  generarGuia(pedido) {
    console.log("  [Coordinadora]  Armando el XML del SOAP...");
    return "900" + pedido.id;
  }
  cotizarFlete(pedido) {
    return 12000 + pedido.peso * 900;
  }
  rastrear(numeroGuia) {
    return "EN REPARTO";
  }
}

class Servientrega extends Transportadora {
  get nombre() { return "Servientrega"; }

  generarGuia(pedido) {
    console.log("  [Servientrega]  Llamando el REST de guias...");
    return "SER-" + pedido.id;
  }
  cotizarFlete(pedido) {
    return 14500 + pedido.peso * 750;
  }
  rastrear(numeroGuia) {
    return "EN BODEGA";
  }
}

class Skydropx extends Transportadora {
  get nombre() { return "Skydropx"; }

  generarGuia(pedido) {
    console.log("  [Skydropx]  Pidiendo el token OAuth...");
    return "SKY-" + pedido.id;
  }
  cotizarFlete(pedido) {
    return 11800 + pedido.peso * 1000;
  }
  rastrear(numeroGuia) {
    return "RECOGIDO";
  }
}


// ------------------------------------------------------------
//  El servicio de envios: este es el que ya no volvemos a tocar.
//  Fijese que aca adentro no hay ni un if preguntando quien es
//  quien, solo le pedimos las cosas a la transportadora.
// ------------------------------------------------------------
class ServicioDeEnvios {

  despachar(pedido, transportadora) {
    console.log("  [Envios]  Pedido " + pedido.id
                + " sale por " + transportadora.nombre);

    const flete = transportadora.cotizarFlete(pedido);
    const guia  = transportadora.generarGuia(pedido);

    console.log("  [Envios]  Guia: " + guia + "  |  Flete: $" + flete);
    return guia;
  }

  // Cotizamos con todas las que nos pasen y nos quedamos con la
  // mas barata. Si algun dia llegan a ser diez, esto queda igualito.
  cotizarLaMasBarata(pedido, transportadoras) {
    let mejor = null;
    for (const t of transportadoras) {
      const precio = t.cotizarFlete(pedido);
      console.log("  [Cotizacion]  " + t.nombre + ": $" + precio);
      if (mejor === null || precio < mejor.precio) {
        mejor = { nombre: t.nombre, precio: precio, transportadora: t };
      }
    }
    return mejor;
  }
}


// ============================================================
//  USO
// ============================================================
const pedido = { id: "1045", cliente: "Carlos Lopez", ciudad: "Pasto", peso: 2 };
const envios = new ServicioDeEnvios();

console.log("--- Flujo 1: despachar con la que nos digan ---");
console.log();
envios.despachar(pedido, new Coordinadora());
console.log();
envios.despachar(pedido, new Skydropx());
console.log();

console.log("--- Flujo 2: cotizar con todas y coger la mas barata ---");
console.log();
const opciones = [new Coordinadora(), new Servientrega(), new Skydropx()];
const mejor = envios.cotizarLaMasBarata(pedido, opciones);
console.log("  Nos quedamos con " + mejor.nombre + " ($" + mejor.precio + ")");
console.log();


// ------------------------------------------------------------
//  [OK] AQUI ES DONDE SE VE EL OCP DE VERDAD
//  Entra Interrapidisimo. Fijese que no subimos a tocar NADA:
//  ni el ServicioDeEnvios ni las otras transportadoras. Solo
//  agregamos esta clase aca abajo y ya quedo andando.
// ------------------------------------------------------------
class Interrapidisimo extends Transportadora {
  get nombre() { return "Interrapidisimo"; }

  generarGuia(pedido) {
    console.log("  [Interrapidisimo]  Enviando la solicitud...");
    return "INT-" + pedido.id;
  }
  cotizarFlete(pedido) {
    return 10500 + pedido.peso * 1100;
  }
  rastrear(numeroGuia) {
    return "ADMITIDO";
  }
}

console.log("--- Flujo 3: nos entra una transportadora nueva ---");
console.log();
envios.despachar(pedido, new Interrapidisimo());
console.log();
const mejor2 = envios.cotizarLaMasBarata(pedido, opciones.concat(new Interrapidisimo()));
console.log("  Ahora la mas barata es " + mejor2.nombre + " ($" + mejor2.precio + ")");
console.log();


console.log("=".repeat(60));
console.log("  CONCLUSION");
console.log("=".repeat(60));
console.log();
console.log("  Clase             | Que le toca            | La tocamos?");
console.log("  " + "-".repeat(57));
console.log("  ServicioDeEnvios  | Coordinar el despacho  | Nunca");
console.log("  Coordinadora      | Su propia API SOAP     | Solo si cambia el SOAP");
console.log("  Servientrega      | Su propia API REST     | Solo si cambia lo suyo");
console.log("  Skydropx          | Su OAuth y su REST     | Solo si cambia lo suyo");
console.log("  Interrapidisimo   | Lo suyo (es la nueva)  | Se agrego, no se modifico");
console.log();
console.log("  Extendemos AGREGANDO, no modificando -> OCP cumplido [OK]");
console.log();
