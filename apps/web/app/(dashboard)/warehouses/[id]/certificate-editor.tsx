'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  Hand,
  Loader2,
  Maximize,
  Minus,
  Plus,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { CertificateElement, CertificateTemplate } from '@smartlogistica/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api-client';

// Worker servido desde /public (mas confiable en Next que el bundling con import.meta.url).
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const RENDER_W = 640; // px CSS del render base de la factura (a zoom 100%)
const QUALITY = 2.5; // resolucion interna del canvas (nitidez al hacer zoom)
const PAD = 60; // margen alrededor de la hoja dentro del lienzo
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;

const round = (n: number): number => Math.round(n * 10) / 10;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type DragState = {
  i: number;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  orig: CertificateElement;
} | null;

export function CertificateEditor({
  warehouseId,
  warehouseName,
  onClose,
}: {
  warehouseId: string;
  warehouseName: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const [pageW, setPageW] = useState(612);
  const [pageH, setPageH] = useState(792);
  const [scale, setScale] = useState(1); // px CSS por punto PDF (base, zoom 100%)
  const [zoom, setZoom] = useState(1);
  const [elements, setElements] = useState<CertificateElement[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [spaceDown, setSpaceDown] = useState(false);

  const scaleRef = useRef(1);
  const zoomRef = useRef(1);
  const dragRef = useRef<DragState>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const spaceRef = useRef(false);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  // Historial (undo/redo).
  const elementsRef = useRef<CertificateElement[]>([]);
  const undoRef = useRef<CertificateElement[][]>([]);
  const redoRef = useRef<CertificateElement[][]>([]);
  const lastKeyRef = useRef('');
  const lastTimeRef = useRef(0);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);
  useEffect(() => {
    spaceRef.current = spaceDown;
  }, [spaceDown]);

  const pushHistory = useCallback(() => {
    undoRef.current.push(elementsRef.current);
    if (undoRef.current.length > 120) undoRef.current.shift();
    redoRef.current = [];
    lastKeyRef.current = '';
  }, []);

  // Agrupa cambios seguidos del mismo campo en un solo paso de historial.
  const recordCoalesced = useCallback((key: string) => {
    const now = Date.now();
    if (key === lastKeyRef.current && now - lastTimeRef.current < 900) {
      lastTimeRef.current = now;
      return;
    }
    lastKeyRef.current = key;
    lastTimeRef.current = now;
    undoRef.current.push(elementsRef.current);
    if (undoRef.current.length > 120) undoRef.current.shift();
    redoRef.current = [];
  }, []);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (prev === undefined) return;
    redoRef.current.push(elementsRef.current);
    lastKeyRef.current = '';
    setElements(prev);
    setSelected(null);
  }, []);
  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (next === undefined) return;
    undoRef.current.push(elementsRef.current);
    lastKeyRef.current = '';
    setElements(next);
    setSelected(null);
  }, []);

  // Cargar la factura (fondo) + la plantilla existente.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let buf: ArrayBuffer;
      try {
        buf = await api.getArrayBuffer(`/v1/warehouses/${warehouseId}/certificate/invoice-pdf`);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof ApiError ? e.message : (e as Error)?.message;
          setError(`No se pudo traer la factura de Alegra de la sede: ${msg}`);
          setLoading(false);
        }
        return;
      }
      const tpl = await api
        .get<CertificateTemplate | null>(`/v1/warehouses/${warehouseId}/certificate/template`)
        .catch(() => null);
      if (cancelled) return;
      try {
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const unscaled = page.getViewport({ scale: 1 });
        const s = RENDER_W / unscaled.width;
        const viewport = page.getViewport({ scale: s * QUALITY });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${unscaled.width * s}px`;
        canvas.style.height = `${unscaled.height * s}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;
        setPageW(unscaled.width);
        setPageH(unscaled.height);
        setScale(s);
        setElements(tpl?.elements ?? []);
        setLoading(false);
      } catch (e) {
        console.error('pdf.js render error', e);
        if (!cancelled) {
          setError(`No se pudo renderizar la factura (pdf.js): ${(e as Error)?.message ?? e}`);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  // Aplicar el scroll pendiente tras un zoom-hacia-el-cursor.
  useLayoutEffect(() => {
    if (pendingScroll.current && viewportRef.current) {
      viewportRef.current.scrollLeft = pendingScroll.current.left;
      viewportRef.current.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  }, [zoom]);

  // Mover / redimensionar / pan (global).
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (panRef.current && viewportRef.current) {
        viewportRef.current.scrollLeft = panRef.current.left - (e.clientX - panRef.current.x);
        viewportRef.current.scrollTop = panRef.current.top - (e.clientY - panRef.current.y);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const k = scaleRef.current * zoomRef.current;
      const dx = (e.clientX - d.startX) / k;
      const dy = (e.clientY - d.startY) / k;
      setElements((prev) =>
        prev.map((el, idx) => {
          if (idx !== d.i) return el;
          if (d.mode === 'move') return { ...el, x: round(d.orig.x + dx), y: round(d.orig.y - dy) };
          if (el.type === 'cover' && d.orig.type === 'cover') {
            return {
              ...el,
              width: Math.max(4, round(d.orig.width + dx)),
              height: Math.max(4, round(d.orig.height + dy)),
              y: round(d.orig.y - dy),
            };
          }
          return el;
        }),
      );
    };
    const up = () => {
      dragRef.current = null;
      panRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  // Teclado: undo/redo, zoom, espacio (pan).
  useEffect(() => {
    const isField = (): boolean => {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      return tag === 'input' || tag === 'textarea';
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isField()) {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (isField()) return;
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (isField()) return;
        e.preventDefault();
        redo();
      } else if (key === '=' || key === '+') {
        e.preventDefault();
        setZoom((z) => clamp(round(z * 1.2), MIN_ZOOM, MAX_ZOOM));
      } else if (key === '-') {
        e.preventDefault();
        setZoom((z) => clamp(round(z / 1.2), MIN_ZOOM, MAX_ZOOM));
      } else if (key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [undo, redo]);

  // Zoom hacia el cursor (Ctrl/⌘ + rueda), fluido. Listener NATIVO no-passive para
  // poder preventDefault (si no, el navegador haria zoom de toda la pagina).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return; // rueda normal = scroll (pan)
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const z = zoomRef.current;
      const baseX = (vp.scrollLeft + mx - PAD) / z;
      const baseY = (vp.scrollTop + my - PAD) / z;
      const nz = clamp(z * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
      pendingScroll.current = { left: PAD + baseX * nz - mx, top: PAD + baseY * nz - my };
      setZoom(nz);
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  const onViewportPointerDown = (e: React.PointerEvent) => {
    // Pan con espacio o boton central.
    if (spaceRef.current || e.button === 1) {
      e.preventDefault();
      const vp = viewportRef.current;
      if (vp) panRef.current = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop };
      return;
    }
    setSelected(null);
  };

  const startDrag = (e: React.PointerEvent, i: number, mode: 'move' | 'resize') => {
    if (spaceRef.current || e.button === 1) return; // dejar que el viewport haga pan
    e.stopPropagation();
    e.preventDefault();
    const orig = elements[i];
    if (!orig) return;
    pushHistory();
    setSelected(i);
    dragRef.current = { i, mode, startX: e.clientX, startY: e.clientY, orig };
  };

  const edit = (field: string, value: unknown) => {
    if (selected == null) return;
    recordCoalesced(`f:${selected}:${field}`);
    setElements((prev) =>
      prev.map((el, idx) => (idx === selected ? ({ ...el, [field]: value } as CertificateElement) : el)),
    );
  };

  const remove = (i: number) => {
    pushHistory();
    setElements((prev) => prev.filter((_, idx) => idx !== i));
    setSelected(null);
  };
  const addCover = () => {
    pushHistory();
    setElements((prev) => [
      ...prev,
      { type: 'cover', x: round(pageW / 2 - 60), y: round(pageH / 2), width: 120, height: 16, color: '#ffffff' },
    ]);
    setSelected(elements.length);
  };
  const addText = () => {
    pushHistory();
    setElements((prev) => [
      ...prev,
      { type: 'text', x: round(pageW / 2 - 60), y: round(pageH / 2), text: 'Texto', size: 9, bold: false, color: '#000000' },
    ]);
    setSelected(elements.length);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/v1/warehouses/${warehouseId}/certificate/template`, { page: 0, elements });
      toast.success('Plantilla guardada');
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const baseW = pageW * scale;
  const baseH = pageH * scale;
  const sel = selected != null ? elements[selected] : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Certificado de Garantia · {warehouseName}</h2>
          <p className="text-[11px] text-muted-foreground">
            Ctrl+rueda: zoom · Espacio/boton central: mover · Ctrl+Z / Ctrl+Y: deshacer/rehacer
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Zoom */}
          <div className="flex items-center rounded-md border border-border">
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(round(z / 1.2), MIN_ZOOM, MAX_ZOOM))}
              className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
              aria-label="Alejar"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="w-12 text-center text-xs tabular-nums text-muted-foreground hover:text-foreground"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(round(z * 1.2), MIN_ZOOM, MAX_ZOOM))}
              className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
              aria-label="Acercar"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                if (viewportRef.current) {
                  viewportRef.current.scrollLeft = 0;
                  viewportRef.current.scrollTop = 0;
                }
              }}
              className="border-l border-border px-1.5 py-1 text-muted-foreground hover:text-foreground"
              aria-label="Ajustar"
            >
              <Maximize className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Undo / Redo */}
          <div className="flex items-center rounded-md border border-border">
            <button
              type="button"
              onClick={undo}
              className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
              aria-label="Deshacer"
              title="Deshacer (Ctrl+Z)"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={redo}
              className="border-l border-border px-1.5 py-1 text-muted-foreground hover:text-foreground"
              aria-label="Rehacer"
              title="Rehacer (Ctrl+Y)"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button variant="outline" size="sm" onClick={addCover}>
            <Square className="h-3.5 w-3.5" />
            Tapar
          </Button>
          <Button variant="outline" size="sm" onClick={addText}>
            <Type className="h-3.5 w-3.5" />
            Texto
          </Button>
          <Button size="sm" onClick={save} loading={saving} disabled={loading}>
            <Save className="h-3.5 w-3.5" />
            Guardar
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Lienzo (zoom + pan) */}
        <div
          ref={viewportRef}
          className="min-h-0 flex-1 overflow-auto bg-muted/40"
          style={{ cursor: spaceDown ? 'grab' : 'default' }}
          onPointerDown={onViewportPointerDown}
        >
          {error ? (
            <div className="m-6 max-w-md rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              {error}
            </div>
          ) : (
            <div style={{ padding: PAD, width: 'min-content' }}>
              <div style={{ width: baseW * zoom, height: baseH * zoom }}>
                <div
                  className="relative shadow-lg"
                  style={{ width: baseW, height: baseH, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
                >
                  <canvas ref={canvasRef} className="block bg-white" />
                  {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : null}
                  {!loading &&
                    elements.map((el, i) => {
                      const active = i === selected;
                      if (el.type === 'cover') {
                        return (
                          <div
                            key={i}
                            onPointerDown={(e) => startDrag(e, i, 'move')}
                            className="absolute cursor-move"
                            style={{
                              left: el.x * scale,
                              top: (pageH - el.y - el.height) * scale,
                              width: el.width * scale,
                              height: el.height * scale,
                              background: el.color,
                              outline: active ? '2px solid #2563eb' : '1px dashed rgba(37,99,235,0.5)',
                            }}
                          >
                            {active ? (
                              <span
                                onPointerDown={(e) => startDrag(e, i, 'resize')}
                                className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm border border-white bg-blue-600"
                                style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'bottom right' }}
                              />
                            ) : null}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={i}
                          onPointerDown={(e) => startDrag(e, i, 'move')}
                          className="absolute cursor-move whitespace-pre"
                          style={{
                            left: el.x * scale,
                            top: (pageH - el.y - el.size) * scale,
                            fontSize: el.size * scale,
                            lineHeight: 1.35,
                            color: el.color,
                            fontWeight: el.bold ? 700 : 400,
                            fontFamily: 'Helvetica, Arial, sans-serif',
                            outline: active ? '2px solid #2563eb' : '1px dashed rgba(37,99,235,0.35)',
                          }}
                        >
                          {el.text || ' '}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Panel de propiedades */}
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-border p-4">
          {sel == null ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Selecciona un elemento para editarlo, o agrega uno con <strong>Tapar</strong> / <strong>Texto</strong>.
              </p>
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
                <p className="font-medium text-foreground">Datos dinamicos (en textos):</p>
                <p className="mt-1 font-mono">{'{cliente} {numeroFactura} {moneda}'}</p>
                <p className="font-mono">{'{fecha} {formaPago} {medioPago}'}</p>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Hand className="h-3.5 w-3.5" />
                Manten Espacio y arrastra para moverte por la hoja.
              </div>
              <p className="text-[11px] text-muted-foreground">
                {elements.length} elemento(s). Las cajas blancas tapan (se ven por el borde punteado); en la
                factura final quedan solidas.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium">
                  {sel.type === 'cover' ? 'Caja (tapar)' : 'Texto'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove(selected!)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Eliminar
                </Button>
              </div>

              {sel.type === 'text' ? (
                <>
                  <Field label="Texto">
                    <textarea
                      value={sel.text}
                      onChange={(e) => edit('text', e.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Tamano">
                      <Input
                        type="number"
                        value={sel.size}
                        onChange={(e) => edit('size', Math.max(4, Number(e.target.value) || 9))}
                        className="h-8"
                      />
                    </Field>
                    <Field label="Color">
                      <input
                        type="color"
                        value={sel.color}
                        onChange={(e) => edit('color', e.target.value)}
                        className="h-8 w-full rounded-md border border-input bg-background"
                      />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={sel.bold} onChange={(e) => edit('bold', e.target.checked)} />
                    Negrita
                  </label>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Ancho">
                    <Input
                      type="number"
                      value={sel.width}
                      onChange={(e) => edit('width', Math.max(4, Number(e.target.value) || 4))}
                      className="h-8"
                    />
                  </Field>
                  <Field label="Alto">
                    <Input
                      type="number"
                      value={sel.height}
                      onChange={(e) => edit('height', Math.max(4, Number(e.target.value) || 4))}
                      className="h-8"
                    />
                  </Field>
                  <Field label="Color de tapado">
                    <input
                      type="color"
                      value={sel.color}
                      onChange={(e) => edit('color', e.target.value)}
                      className="h-8 w-full rounded-md border border-input bg-background"
                    />
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
                <Field label="X">
                  <Input
                    type="number"
                    value={sel.x}
                    onChange={(e) => edit('x', Number(e.target.value) || 0)}
                    className="h-8"
                  />
                </Field>
                <Field label="Y">
                  <Input
                    type="number"
                    value={sel.y}
                    onChange={(e) => edit('y', Number(e.target.value) || 0)}
                    className="h-8"
                  />
                </Field>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px]">{label}</Label>
      {children}
    </div>
  );
}
