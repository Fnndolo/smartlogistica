/**
 * ¿Este build es el AMBIENTE DE PRUEBAS? (NEXT_PUBLIC_SANDBOX_MODE=true en el
 * servicio web de pruebas). Next la incrusta al COMPILAR: cambiarla exige
 * volver a desplegar el web.
 *
 * Lo que de verdad protege produccion vive en el API (SANDBOX_MODE); aqui
 * solo se marca la interfaz para que nadie confunda una pestaña con la otra.
 */
export const IS_SANDBOX = /^(1|true|yes|on|si|sí)$/i.test(
  (process.env.NEXT_PUBLIC_SANDBOX_MODE ?? '').trim(),
);

/** Nombre de la app con la marca de pruebas cuando corresponde. */
export const APP_NAME = IS_SANDBOX ? 'SmartLogistica PRUEBAS' : 'SmartLogistica';
