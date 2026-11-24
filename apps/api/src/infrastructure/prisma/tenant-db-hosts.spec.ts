import { tenantDbHosts } from './tenant-connection.service';

describe('host de la DB del tenant', () => {
  // Ficticio: el host REAL de produccion no va en el repositorio.
  const PROD_ROW = 'db-produccion.ejemplo.net:5432';

  it('normal: primero el de la variable y, de respaldo, el de la fila', () => {
    expect(tenantDbHosts('postgres.railway.internal', PROD_ROW, false)).toEqual([
      'postgres.railway.internal',
      PROD_ROW,
    ]);
    expect(tenantDbHosts(undefined, PROD_ROW, false)).toEqual([PROD_ROW]);
    expect(tenantDbHosts(PROD_ROW, PROD_ROW, false)).toEqual([PROD_ROW]);
  });

  it('modo pruebas: SOLO el de la variable, nunca la fila de produccion', () => {
    expect(tenantDbHosts(' db-pruebas.railway.internal ', PROD_ROW, true)).toEqual([
      'db-pruebas.railway.internal',
    ]);
  });

  it('modo pruebas sin TENANT_DB_HOST: no arranca contra produccion', () => {
    expect(() => tenantDbHosts(undefined, PROD_ROW, true)).toThrow(/falta TENANT_DB_HOST/);
    expect(() => tenantDbHosts('  ', PROD_ROW, true)).toThrow(/falta TENANT_DB_HOST/);
  });
});
