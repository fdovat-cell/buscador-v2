import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  FolderOpen,
  ImageOff,
  MessageCircle,
  Minus,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

type Product = {
  codigo: string;
  descripcion: string;
  precio?: number | null;
  precio_usd?: number | null;
  moneda?: string | null;
  categoria?: string | null;
  subcategoria_id?: string | number | null;
  marcas?: string[] | null;
  modalidad?: string | null;
  precio_unitario?: number | null;
  imagenes?: string[] | null;
  proveedor?: number | null;
};

type OrderLine = { product: Product; quantity: number };
type SortKey = 'relevance' | 'codigo' | 'descripcion' | 'precio' | 'categoria' | 'marca';
type Subcategory = { id: string; label: string; parent: string };
type CategorySummary = { label: string; count: number; subcategories: Subcategory[] };

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL;
// Fotos servidas desde Supabase Storage (bucket publico "fotos-productos"),
// ya no desde el build de Cloudflare Pages: asi se pueden agregar/actualizar
// fotos sin disparar un rebuild del sitio.
const IMAGES_BASE_URL = 'https://xxlgsipmocwizhafinwr.supabase.co/storage/v1/object/public/fotos-productos';
const assetUrl = (path: string) => `${IMAGES_BASE_URL}/${path.replace(/^\/+/, '').split('/').pop()}`;

// Datos de catálogo (productos, subcategorías, orden de categorías) se sirven
// desde Supabase Storage, no desde el bundle de Cloudflare Pages: así el admin
// los actualiza sin disparar un rebuild del sitio. Las fotos siguen viniendo
// del bundle (assetUrl) porque cambian con poca frecuencia.
// Completar con la URL del proyecto de Supabase, ej:
// 'https://xxxxxxxxxxxx.supabase.co/storage/v1/object/public/catalogo-data'
const DATA_BASE_URL = 'https://xxlgsipmocwizhafinwr.supabase.co/storage/v1/object/public/catalogo-data';
const dataUrl = (file: string) => `${DATA_BASE_URL}/${file}`;

function getSafeStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    const probeKey = '__pelpap_v2_storage_probe__';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    getSafeStorage()?.setItem(key, value);
  } catch {
    // Some preview iframes deny storage access even after the capability check.
  }
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function getCurrency(product: Product) {
  return String(product.moneda || (product.precio_usd && !product.precio ? 'USD' : 'ARS')).toUpperCase();
}

function currencyLabel(currency: string) {
  return currency === 'USD' ? 'USD' : '$';
}

function getPrice(product: Product, overrides: Record<string, number>) {
  if (overrides[product.codigo] !== undefined) return Number(overrides[product.codigo]) || 0;
  return Number(product.precio ?? product.precio_usd ?? 0) || 0;
}

function formatPrice(value: number, currency: string) {
  const amount = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return `${currencyLabel(currency)} ${amount}`;
}

function normalizeSubcategories(raw: unknown): Subcategory[] {
  const result: Subcategory[] = [];
  const add = (item: unknown, fallbackParent = '') => {
    if (typeof item === 'string' || typeof item === 'number') {
      const value = String(item).trim();
      if (value) result.push({ id: value, label: value, parent: fallbackParent });
      return;
    }
    if (!item || typeof item !== 'object') return;
    const entry = item as Record<string, unknown>;
    if (entry.activo === false || entry.active === false) return;
    const nested = entry.subcategorias ?? entry.subcategories;
    const nestedParent = entry.categoria ?? entry.category ?? entry.categoria_nombre ?? entry.category_name ?? entry.parent ?? entry.parent_id ?? entry.categoria_id ?? fallbackParent;
    if (Array.isArray(nested)) {
      nested.forEach((child) => add(child, String(nestedParent ?? '')));
      return;
    }
    const id = entry.id ?? entry.subcategoria_id ?? entry.codigo ?? entry.slug;
    const label = entry.nombre ?? entry.name ?? entry.descripcion ?? entry.label ?? (id ? `Subcategoría ${id}` : '');
    const parent = entry.categoria ?? entry.category ?? entry.categoria_nombre ?? entry.category_name ?? entry.parent ?? entry.parent_id ?? entry.categoria_id ?? fallbackParent;
    if (id != null && String(label).trim()) result.push({ id: String(id), label: String(label).trim(), parent: String(parent ?? '').trim() });
  };
  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) add(item);
    });
  } else if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const collection = record.subcategorias ?? record.subcategories ?? record.data ?? record.items;
    if (Array.isArray(collection)) {
      collection.forEach((item) => add(item));
    } else {
      Object.entries(record).forEach(([parent, value]) => {
        if (Array.isArray(value)) value.forEach((item) => add(item, parent));
        else if (value && typeof value === 'object') add(value, parent);
      });
    }
  }
  return [...new Map(result.map((item) => [`${item.parent}|${item.id}`, item])).values()];
}

function subcategoriesFor(subcategories: Subcategory[], category: string) {
  const normalizedCategory = normalize(category);
  return subcategories.filter((item) => normalize(item.parent) === normalizedCategory || item.parent === category);
}

function CategoryBrowser({
  categories,
  expandedCategory,
  subcategoriesLoading,
  onCategory,
  onSubcategory,
  onBack,
}: {
  categories: CategorySummary[];
  expandedCategory: string | null;
  subcategoriesLoading: boolean;
  onCategory: (category: CategorySummary) => void;
  onSubcategory: (category: CategorySummary, subcategory: Subcategory) => void;
  onBack: () => void;
}) {
  const expanded = categories.find((category) => category.label === expandedCategory);
  const showSubcategoryScreen = Boolean(expanded && expanded.subcategories.length > 0);

  useEffect(() => {
    if (showSubcategoryScreen) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [showSubcategoryScreen, expandedCategory]);

  if (expanded && showSubcategoryScreen) {
    return (
      <div className="category-browser" data-testid="category-browser">
        <button className="back-button" onClick={onBack} data-testid="button-back-categories">
          <ChevronLeft size={16} /> Categorías
        </button>
        <div className="category-browser-head">
          <div>
            <div className="eyebrow">Dentro de {expanded.label}</div>
            <h2 className="category-browser-title">Elegí un tipo</h2>
            <p className="category-browser-copy">Tocá el tipo exacto de artículo que buscás.</p>
          </div>
          <span className="category-count">{expanded.subcategories.length} opciones</span>
        </div>
        <div className="subcategory-list">
          {expanded.subcategories.map((subcategory) => (
            <button className="subcategory-row" key={subcategory.id} onClick={() => onSubcategory(expanded, subcategory)} data-testid={`button-subcategory-${subcategory.id}`}>
              <span className="subcategory-marker" />
              <span>{subcategory.label}</span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="category-browser" data-testid="category-browser">
      <div className="category-browser-head">
        <div>
          <div className="eyebrow">Explorar por familia</div>
          <h2 className="category-browser-title">Elegí una categoría</h2>
          <p className="category-browser-copy">Primero la familia. Después, el tipo exacto de artículo.</p>
        </div>
        <span className="category-count">{categories.length} categorías</span>
      </div>
      {subcategoriesLoading && <div className="category-loading" role="status"><span className="loading-dot" /> Cargando subcategorías disponibles…</div>}
      {!categories.length ? (
        <div className="state-card category-empty" data-testid="empty-categories">
          <div className="error-mark"><FolderOpen size={22} /></div>
          <h2>No hay categorías para mostrar</h2>
          <p>Cuando el catálogo tenga artículos con categoría, van a aparecer acá.</p>
        </div>
      ) : (
        <div className="category-grid">
          {categories.map((category, index) => (
            <button
              className={`category-tile ${expandedCategory === category.label ? 'active' : ''}`}
              style={{ animationDelay: `${Math.min(index, 16) * 18}ms` }}
              key={category.label}
              onClick={() => onCategory(category)}
              data-testid={`button-category-${category.label}`}
            >
              <span className="category-tile-icon"><FolderOpen size={17} /></span>
              <span className="category-tile-copy"><strong>{category.label}</strong><small>{category.count} {category.count === 1 ? 'artículo' : 'artículos'}</small></span>
              <ChevronRight className="category-tile-arrow" size={17} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function compactPrice(value: number, currency: string) {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function ProductImage({ product, detail = false, imageIndex = 0 }: { product: Product; detail?: boolean; imageIndex?: number }) {
  const [failed, setFailed] = useState(false);
  const source = product.imagenes?.[imageIndex] || product.imagenes?.[0];
  useEffect(() => setFailed(false), [source]);
  if (!source || failed) {
    return (
      <div className="image-missing" data-testid={`image-missing-${product.codigo}`}>
        <ImageOff size={detail ? 34 : 25} strokeWidth={1.4} />
        <span>Foto no disponible</span>
      </div>
    );
  }
  return <img src={assetUrl(source)} alt={product.descripcion} data-testid={`img-product-${product.codigo}`} onError={() => setFailed(true)} />;
}

function SkeletonGrid() {
  return <div className="product-grid" data-testid="loading-products">{Array.from({ length: 12 }, (_, index) => <div className="skeleton-card" key={index} />)}</div>;
}

function ProductDetail({
  product,
  price,
  onClose,
  onAdd,
  onSavePrice,
}: {
  product: Product;
  price: number;
  onClose: () => void;
  onAdd: (product: Product) => void;
  onSavePrice: (product: Product, value: number) => void;
}) {
  const [draftPrice, setDraftPrice] = useState(String(price));
  const [saved, setSaved] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  const currency = getCurrency(product);
  const brand = product.marcas?.filter(Boolean).join(', ') || 'Sin marca informada';
  const images = product.imagenes?.filter(Boolean) || [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const save = () => {
    const numeric = Number(draftPrice.replace(',', '.'));
    if (Number.isFinite(numeric) && numeric >= 0) {
      onSavePrice(product, numeric);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" data-testid="product-detail">
        <button className="modal-close" onClick={onClose} aria-label="Cerrar detalle" data-testid="button-close-detail"><X size={17} /></button>
        <div className="detail-grid">
          <div className="detail-visual">
            <ProductImage product={product} detail imageIndex={imageIndex} />
            <span className="product-code">{product.codigo}</span>
            {images.length > 1 && <div className="detail-thumbs" aria-label="Más fotos del artículo">{images.map((image, index) => <button className={`detail-thumb ${index === imageIndex ? 'active' : ''}`} key={image} onClick={() => setImageIndex(index)} aria-label={`Ver foto ${index + 1}`} data-testid={`button-detail-image-${index}`}><img src={assetUrl(image)} alt="" /></button>)}</div>}
          </div>
          <div className="detail-copy">
            <div className="eyebrow">Ficha de artículo</div>
            <h2 id="detail-title">{product.descripcion}</h2>
            <div className="detail-meta"><span className="code-tag">{product.codigo}</span><span className="detail-type">{product.categoria || 'Sin categoría'}</span></div>
            <div className="detail-price" data-testid={`detail-price-${product.codigo}`}>{formatPrice(price, currency)} <small>/ precio de lista</small></div>
            <div className="detail-fields">
              <div><div className="detail-field-label">Marca</div><div className="detail-field-value">{brand}</div></div>
              <div><div className="detail-field-label">Categoría</div><div className="detail-field-value">{product.categoria || 'Sin categoría'}</div></div>
              <div><div className="detail-field-label">Moneda</div><div className="detail-field-value">{currencyLabel(currency)}</div></div>
              <div><div className="detail-field-label">Modalidad</div><div className="detail-field-value">{product.modalidad || 'No especificada'}</div></div>
              <div><div className="detail-field-label">Precio unitario</div><div className="detail-field-value">{product.precio_unitario ? formatPrice(product.precio_unitario, currency) : 'No informado'}</div></div>
              <div><div className="detail-field-label">Proveedor</div><div className="detail-field-value">{product.proveedor != null ? `Proveedor ${product.proveedor}` : 'Sin asignar'}</div></div>
            </div>
            <div className="price-edit">
              <Pencil size={14} color="hsl(213 11% 46%)" />
              <input type="number" min="0" step="0.01" value={draftPrice} onChange={(event) => { setDraftPrice(event.target.value); setSaved(false); }} aria-label="Precio local provisorio" data-testid={`input-price-${product.codigo}`} />
              <button className="tiny-button" onClick={save} data-testid={`button-save-price-${product.codigo}`}>{saved ? <><Check size={13} /> Guardado</> : 'Guardar precio'}</button>
            </div>
            <p className="price-note">El precio local se conserva en este dispositivo. No modifica el catálogo de origen.</p>
            <button className="primary-button" style={{ width: '100%', marginTop: 20 }} onClick={() => onAdd(product)} data-testid={`button-add-detail-${product.codigo}`}><Plus size={16} /> Agregar a la nota</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function groupByProveedor(lines: OrderLine[]) {
  const groups = new Map<string, { proveedor: number | null; label: string; lines: OrderLine[] }>();
  lines.forEach((line) => {
    const proveedor = line.product.proveedor ?? null;
    const key = proveedor === null ? 'sin-proveedor' : String(proveedor);
    const label = proveedor === null ? 'Sin proveedor asignado' : `Proveedor ${proveedor}`;
    if (!groups.has(key)) groups.set(key, { proveedor, label, lines: [] });
    groups.get(key)!.lines.push(line);
  });
  return [...groups.values()].sort((a, b) => {
    if (a.proveedor === null) return 1;
    if (b.proveedor === null) return -1;
    return a.proveedor - b.proveedor;
  });
}

function OrderPanel({
  lines,
  note,
  overrides,
  onNoteChange,
  onQuantity,
  onRemove,
  onClear,
  onDownload,
  onCopy,
  onWhatsApp,
}: {
  lines: OrderLine[];
  note: string;
  overrides: Record<string, number>;
  onNoteChange: (value: string) => void;
  onQuantity: (code: string, delta: number) => void;
  onRemove: (code: string) => void;
  onClear: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onWhatsApp: () => void;
}) {
  const ars = lines.filter((line) => getCurrency(line.product) !== 'USD').reduce((sum, line) => sum + getPrice(line.product, overrides) * line.quantity, 0);
  const usd = lines.filter((line) => getCurrency(line.product) === 'USD').reduce((sum, line) => sum + getPrice(line.product, overrides) * line.quantity, 0);
  const totals = [ars > 0 ? formatPrice(ars, 'ARS') : '', usd > 0 ? formatPrice(usd, 'USD') : ''].filter(Boolean);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <aside className="order-panel" id="order-panel" data-testid="order-panel">
      <div className="order-head"><div><div className="order-kicker">Borrador local</div><h2 className="order-title">Nota de pedido</h2></div><span className="order-count" data-testid="text-order-count">{count}</span></div>
      {lines.length === 0 ? (
        <div className="empty-order" data-testid="empty-order"><div className="empty-order-icon"><ShoppingBag size={20} /></div><p>Agregá artículos desde el catálogo para preparar la visita.</p></div>
      ) : (
        <>
          <div className="order-items">
            {groupByProveedor(lines).map((group) => (
              <div key={group.label} className="order-group">
                <div className="order-group-label">{group.label}</div>
                {group.lines.map(({ product, quantity }) => <div className="order-item" key={product.codigo} data-testid={`order-item-${product.codigo}`}>
                  <div><p className="order-item-name">{product.descripcion}</p><span className="order-item-code">{product.codigo} · {compactPrice(getPrice(product, overrides), getCurrency(product))} {currencyLabel(getCurrency(product))}</span>
                    <div className="qty-control"><button onClick={() => onQuantity(product.codigo, -1)} aria-label={`Disminuir cantidad de ${product.codigo}`} data-testid={`button-decrease-${product.codigo}`}><Minus size={12} /></button><span className="qty-value">{quantity}</span><button onClick={() => onQuantity(product.codigo, 1)} aria-label={`Aumentar cantidad de ${product.codigo}`} data-testid={`button-increase-${product.codigo}`}><Plus size={12} /></button><button className="remove-item" onClick={() => onRemove(product.codigo)} aria-label={`Quitar ${product.codigo}`} data-testid={`button-remove-${product.codigo}`}><Trash2 size={13} /></button></div>
                  </div>
                  <div className="order-item-price">{compactPrice(getPrice(product, overrides) * quantity, getCurrency(product))}<br />{currencyLabel(getCurrency(product))} · {quantity} un.</div>
                </div>)}
              </div>
            ))}
          </div>
          <textarea className="order-note" value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Nota para el comercio, entrega o seguimiento..." aria-label="Nota del pedido" data-testid="textarea-order-note" />
          <div className="order-total"><span className="total-label">Total estimado</span>{totals.length > 1 ? <span className="mixed-total">{totals.join(' + ')}</span> : <span className="total-value">{totals[0] || '—'}</span>}</div>
          <div className="order-actions"><button onClick={onClear} data-testid="button-clear-order">Limpiar</button><button onClick={onCopy} data-testid="button-copy-order-panel"><Copy size={13} /> Copiar</button><button className="download-button" onClick={onDownload} data-testid="button-download-order"><Download size={14} /> Descargar CSV</button></div>
          <button className="whatsapp-button" onClick={onWhatsApp} data-testid="button-whatsapp-order" style={{ width: '100%', marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#25D366', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 14px', fontWeight: 600, cursor: 'pointer' }}><MessageCircle size={16} /> Enviar por WhatsApp</button>
        </>
      )}
    </aside>
  );
}

function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [subcategoriesLoading, setSubcategoriesLoading] = useState(true);
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [subcategoryFilter, setSubcategoryFilter] = useState('all');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('precio');
  const [ascending, setAscending] = useState(true);
  const [visibleCount, setVisibleCount] = useState(48);
  const [selected, setSelected] = useState<Product | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<Record<string, OrderLine>>({});
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [copied, setCopied] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const modalOpenRef = useRef(false);
  const exitArmedRef = useRef(false);
  const exitArmedTimer = useRef<number | undefined>(undefined);

  const notify = (message: string) => {
    setFeedback(message);
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback(''), 2300);
  };

  // Botón "atrás" del celular: si hay una ficha abierta, la cierra en vez de salir de la app.
  // Si no hay nada abierto, primero avisa y recién con un segundo toque deja salir.
  const openSelected = (product: Product) => {
    setSelected(product);
    window.history.pushState({ modal: true }, '');
    modalOpenRef.current = true;
  };
  const closeSelected = () => {
    if (modalOpenRef.current) {
      window.history.back();
    } else {
      setSelected(null);
    }
  };
  useEffect(() => {
    window.history.pushState({ base: true }, '');
    const onPopState = () => {
      if (modalOpenRef.current) {
        modalOpenRef.current = false;
        setSelected(null);
        return;
      }
      if (exitArmedRef.current) return;
      exitArmedRef.current = true;
      notify('Tocá atrás de nuevo para salir');
      window.history.pushState({ base: true }, '');
      if (exitArmedTimer.current) window.clearTimeout(exitArmedTimer.current);
      exitArmedTimer.current = window.setTimeout(() => { exitArmedRef.current = false; }, 2000);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadCatalog = async () => {
    try {
      setLoading(true);
      const response = await fetch(dataUrl('productos.json'), { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo leer el catálogo local.');
      const data = await response.json() as Product[];
      setProducts(Array.isArray(data) ? data.filter((item) => item?.codigo && item?.descripcion && (item as { activo?: boolean }).activo !== false) : []);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo cargar el catálogo.');
    } finally {
      setLoading(false);
    }
  };

  const loadSubcategories = async () => {
    try {
      setSubcategoriesLoading(true);
      const response = await fetch(dataUrl('subcategorias.json'), { cache: 'no-store' });
      if (!response.ok) {
        setSubcategories([]);
        return;
      }
      const data = await response.json();
      setSubcategories(normalizeSubcategories(data));
    } catch {
      // La estructura es opcional: el catálogo sigue funcionando como lista plana.
      setSubcategories([]);
    } finally {
      setSubcategoriesLoading(false);
    }
  };

  const loadCategoryOrder = async () => {
    try {
      const response = await fetch(dataUrl('categorias_orden.json'), { cache: 'no-store' });
      if (!response.ok) {
        setCategoryOrder([]);
        return;
      }
      const data = await response.json();
      setCategoryOrder(Array.isArray(data) ? data.filter((item): item is string => typeof item === 'string') : []);
    } catch {
      setCategoryOrder([]);
    }
  };

  useEffect(() => {
    const storage = getSafeStorage();
    setStorageAvailable(Boolean(storage));
    const read = <T,>(key: string, fallback: T): T => {
      try {
        const value = storage?.getItem(key);
        return value ? JSON.parse(value) as T : fallback;
      } catch {
        return fallback;
      }
    };
    setOverrides(read('pelpap-v2-price-overrides', {} as Record<string, number>));
    setOrder(read('pelpap-v2-order', {} as Record<string, OrderLine>));
    setNote(storage?.getItem('pelpap-v2-order-note') || '');
    void loadCatalog();
      void loadSubcategories();
      void loadCategoryOrder();
  }, []);

  useEffect(() => { writeStorage('pelpap-v2-price-overrides', JSON.stringify(overrides)); }, [overrides]);
  useEffect(() => { writeStorage('pelpap-v2-order', JSON.stringify(order)); }, [order]);
  useEffect(() => { writeStorage('pelpap-v2-order-note', note); }, [note]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 150);
    return () => window.clearTimeout(timer);
  }, [search]);

  const sortTouchedRef = useRef(false);
  useEffect(() => {
    if (sortTouchedRef.current) return;
    setSortKey(debouncedSearch.trim() ? 'relevance' : 'precio');
  }, [debouncedSearch]);

  const brands = useMemo(() => [...new Set(products.flatMap((item) => item.marcas || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [products]);
  const categories = useMemo(() => {
    const present = [...new Set(products.map((item) => item.categoria).filter((item): item is string => Boolean(item)))];
    const alphabetical = [...present].sort((a, b) => a.localeCompare(b, 'es'));
    if (!categoryOrder.length) return alphabetical;
    const rank = new Map(categoryOrder.map((label, index) => [label, index]));
    const ordered = [...present].sort((a, b) => {
      const rankA = rank.has(a) ? rank.get(a)! : Number.MAX_SAFE_INTEGER;
      const rankB = rank.has(b) ? rank.get(b)! : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.localeCompare(b, 'es');
    });
    return ordered;
  }, [products, categoryOrder]);
  const availableSubcategories = useMemo(() => {
    const known = [...subcategories];
    if (subcategories.length === 0) {
      products.forEach((product) => {
        if (product.categoria && product.subcategoria_id != null && !known.some((item) => item.id === String(product.subcategoria_id) && normalize(item.parent) === normalize(product.categoria!))) {
          known.push({ id: String(product.subcategoria_id), label: `Subcategoría ${product.subcategoria_id}`, parent: product.categoria });
        }
      });
    }
    return known;
  }, [products, subcategories]);
  const categorySummaries = useMemo<CategorySummary[]>(() => categories.map((label) => ({
    label,
    count: products.filter((product) => product.categoria === label).length,
    subcategories: subcategoriesFor(availableSubcategories, label),
  })), [categories, products, availableSubcategories]);
  const searchIndex = useMemo(() => products.map((product) => ({
    product,
    text: normalize([product.codigo, product.descripcion, product.categoria || '', ...(product.marcas || [])].join(' ')),
    codigoNorm: normalize(product.codigo || ''),
    descripcionNorm: normalize(product.descripcion || ''),
    marcasNorm: (product.marcas || []).map((marca) => normalize(marca || '')),
  })), [products]);

  const filteredProducts = useMemo(() => {
    const queryJoined = normalize(debouncedSearch);
    const queryTokens = queryJoined.split(/\s+/).filter(Boolean);
    const matching = searchIndex.filter(({ product, text }) => {
       return (queryTokens.length === 0 || queryTokens.every((token) => text.includes(token))) &&
         (brandFilter === 'all' || product.marcas?.includes(brandFilter)) &&
         (categoryFilter === 'all' || product.categoria === categoryFilter) &&
         (subcategoryFilter === 'all' || String(product.subcategoria_id ?? '') === subcategoryFilter);
    });
    return matching.sort((a, b) => {
      if (sortKey === 'relevance') {
        if (!queryJoined) {
          const comparison = normalize(a.product.descripcion || '').localeCompare(normalize(b.product.descripcion || ''), 'es', { numeric: true });
          return ascending ? comparison : -comparison;
        }
        const score = (entry: typeof a) => {
          if (entry.codigoNorm === queryJoined) return 1000;
          const fields = [entry.codigoNorm, entry.descripcionNorm, ...entry.marcasNorm];
          return fields.reduce((sum, field, index) => sum + (field === queryJoined ? 100 - index * 5 : field.startsWith(queryJoined) ? 50 - index * 3 : field.includes(queryJoined) ? 10 - index : 0), 0);
        };
        return score(b) - score(a);
      }
      const value = (entry: typeof a) => {
        const product = entry.product;
        if (sortKey === 'precio') return getPrice(product, overrides);
        if (sortKey === 'marca') return normalize([...(product.marcas || [])].sort((x, y) => x.localeCompare(y, 'es'))[0] || '');
        return normalize(String(product[sortKey] || ''));
      };
      const left = value(a); const right = value(b);
      const comparison = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'es', { numeric: true });
      return ascending ? comparison : -comparison;
    }).map((entry) => entry.product);
  }, [searchIndex, debouncedSearch, brandFilter, categoryFilter, subcategoryFilter, sortKey, ascending, overrides]);

  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const hasActiveQuery = debouncedSearch.trim() !== '' || brandFilter !== 'all' || categoryFilter !== 'all' || subcategoryFilter !== 'all';
  const expandedSummary = expandedCategory ? categorySummaries.find((category) => category.label === expandedCategory) : undefined;
  const browsingSubcategories = Boolean(expandedSummary && expandedSummary.subcategories.length && categoryFilter === 'all' && subcategoryFilter === 'all' && !debouncedSearch.trim() && brandFilter === 'all');
  const lines = Object.values(order);
  const orderCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const imageCount = useMemo(() => products.filter((product) => product.imagenes?.length).length, [products]);

  const updateSearch = (value: string) => { setSearch(value); setVisibleCount(48); };
  const resetFilters = () => { updateSearch(''); setBrandFilter('all'); setCategoryFilter('all'); setSubcategoryFilter('all'); setExpandedCategory(null); setSortKey('precio'); setAscending(true); sortTouchedRef.current = false; };
  const clearCategorySelection = () => { setCategoryFilter('all'); setSubcategoryFilter('all'); setExpandedCategory(null); setVisibleCount(48); };
  const chooseCategory = (category: CategorySummary) => {
    updateSearch('');
    setBrandFilter('all');
    setSubcategoryFilter('all');
    setExpandedCategory(category.label);
    if (!category.subcategories.length) setCategoryFilter(category.label);
    else setCategoryFilter('all');
  };
  const chooseSubcategory = (category: CategorySummary, subcategory: Subcategory) => {
    updateSearch('');
    setBrandFilter('all');
    setExpandedCategory(category.label);
    setCategoryFilter(category.label);
    setSubcategoryFilter(subcategory.id);
    setVisibleCount(48);
  };
  const addToOrder = (product: Product) => {
    setOrder((current) => { const existing = current[product.codigo]; return { ...current, [product.codigo]: { product, quantity: (existing?.quantity || 0) + 1 } }; });
    notify(`${product.codigo} agregado a la nota`);
  };
  const changeQuantity = (code: string, delta: number) => {
    setOrder((current) => { const line = current[code]; if (!line) return current; const quantity = line.quantity + delta; if (quantity <= 0) { const next = { ...current }; delete next[code]; return next; } return { ...current, [code]: { ...line, quantity } }; });
  };
  const removeFromOrder = (code: string) => { setOrder((current) => { const next = { ...current }; delete next[code]; return next; }); notify('Artículo quitado de la nota'); };
  const clearOrder = () => { if (window.confirm('¿Querés limpiar la nota de pedido?')) { setOrder({}); setNote(''); notify('Nota de pedido limpia'); } };
  const savePrice = (product: Product, value: number) => { setOverrides((current) => ({ ...current, [product.codigo]: value })); setOrder((current) => current[product.codigo] ? { ...current, [product.codigo]: { ...current[product.codigo], product } } : current); notify(`Precio local guardado para ${product.codigo}`); };

  const orderText = () => {
    const groups = groupByProveedor(lines);
    const itemLines = groups.flatMap((group) => [
      `— ${group.label} —`,
      ...group.lines.map(({ product, quantity }) => {
        const unitPrice = getPrice(product, overrides);
        const subtotal = unitPrice * quantity;
        const currency = currencyLabel(getCurrency(product));
        return `${product.codigo} · ${quantity} x ${product.descripcion} · ${currency} ${compactPrice(unitPrice, getCurrency(product))} c/u · Subtotal: ${currency} ${compactPrice(subtotal, getCurrency(product))}`;
      }),
    ]);
    const arsTotal = lines.filter((line) => getCurrency(line.product) !== 'USD').reduce((sum, line) => sum + getPrice(line.product, overrides) * line.quantity, 0);
    const usdTotal = lines.filter((line) => getCurrency(line.product) === 'USD').reduce((sum, line) => sum + getPrice(line.product, overrides) * line.quantity, 0);
    const totalLines = [arsTotal > 0 ? `Total: $ ${compactPrice(arsTotal, 'ARS')}` : '', usdTotal > 0 ? `Total USD: USD ${compactPrice(usdTotal, 'USD')}` : ''].filter(Boolean);
    return ['NOTA DE PEDIDO', ...itemLines, ...totalLines, note ? `Nota: ${note}` : ''].filter(Boolean).join('\n');
  };
  const sendWhatsApp = () => {
    if (!lines.length) return;
    const url = `https://wa.me/59896190002?text=${encodeURIComponent(orderText())}`;
    window.open(url, '_blank');
  };
  const copyOrder = async () => {
    if (!lines.length) return;
    const text = orderText();
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else { const helper = document.createElement('textarea'); helper.value = text; document.body.appendChild(helper); helper.select(); document.execCommand('copy'); helper.remove(); }
      setCopied(true); notify('Nota copiada al portapapeles'); window.setTimeout(() => setCopied(false), 1700);
    } catch { notify('No pudimos copiar la nota'); }
  };
  const downloadOrder = () => {
    if (!lines.length) return;
    const orderedLines = groupByProveedor(lines).flatMap((group) => group.lines);
    const rows = [['Proveedor', 'Código', 'Descripción', 'Marca', 'Cantidad', 'Precio unitario', 'Moneda', 'Subtotal'], ...orderedLines.map(({ product, quantity }) => [product.proveedor != null ? String(product.proveedor) : 'Sin asignar', product.codigo, product.descripcion, product.marcas?.join(', ') || '', String(quantity), String(getPrice(product, overrides)), getCurrency(product), String(getPrice(product, overrides) * quantity)])];
    const content = `${rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(';')).join('\n')}\n\nNota: ${note}`;
    const url = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8;' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `nota-pedido-pelpap-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
    notify('CSV descargado');
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" data-testid="brand-pelpap"><span className="brand-mark">P</span><span className="brand-name">Pel Sas</span><span className="brand-sub">buscador / v2</span></div>
        <div className="topbar-actions"><span className="status-pill"><span className="status-dot" /> Catálogo local</span><span className="avatar">VD</span></div>
      </header>
      {!storageAvailable && <div className="storage-notice" role="status"><AlertCircle size={15} /><span>La vista previa bloquea el guardado local por ahora. El catálogo funciona normalmente; los pedidos y precios se conservarán al abrir la V2 en un navegador con almacenamiento habilitado.</span></div>}
      <main className="main">
        <div className="intro">
          <div className="catalog-stats"><div className="stat"><span className="stat-value" data-testid="text-product-count">{products.length ? products.length.toLocaleString('es-AR') : '—'}</span><span className="stat-label">artículos</span></div><div className="stat"><span className="stat-value">{imageCount ? imageCount.toLocaleString('es-AR') : '—'}</span><span className="stat-label">con foto</span></div></div>
        </div>
        <section className="toolbar" aria-label="Filtros del catálogo">
          <div className="search-wrap"><Search className="search-icon" size={19} /><input autoFocus className="search-input" type="search" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Buscar por código, descripción, marca o categoría..." aria-label="Buscar productos" data-testid="input-search-products" />{search && <button className="clear-search" onClick={() => updateSearch('')} aria-label="Limpiar búsqueda" data-testid="button-clear-search"><X size={16} /></button>}</div>
          <div className="toolbar-row">
             <label className="select-wrap"><select value={brandFilter} onChange={(event) => { setBrandFilter(event.target.value); setSubcategoryFilter('all'); setExpandedCategory(null); setVisibleCount(48); }} aria-label="Filtrar por marca" data-testid="select-filter-brand"><option value="all">Todas las marcas</option>{brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}</select><ChevronDown className="select-chevron" size={15} /></label>
             <label className="select-wrap"><select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setSubcategoryFilter('all'); setExpandedCategory(null); setVisibleCount(48); }} aria-label="Filtrar por categoría" data-testid="select-filter-category"><option value="all">Todas las categorías</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select><ChevronDown className="select-chevron" size={15} /></label>
            <div className="sort-control" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'hsl(213 11% 46%)', whiteSpace: 'nowrap' }}>Ordenar por:</span>
              <label className="select-wrap" style={{ minWidth: 190 }}>
                <select
                  value={`${sortKey}-${ascending ? 'asc' : 'desc'}`}
                  onChange={(event) => {
                    sortTouchedRef.current = true;
                    const [key, direction] = event.target.value.split('-') as [SortKey, 'asc' | 'desc'];
                    setSortKey(key);
                    setAscending(direction === 'asc');
                    setVisibleCount(48);
                  }}
                  aria-label="Ordenar catálogo"
                  data-testid="select-sort-products"
                >
                  <option value="relevance-desc">Relevancia</option>
                  <option value="precio-asc">Precio: menor a mayor</option>
                  <option value="precio-desc">Precio: mayor a menor</option>
                  <option value="descripcion-asc">Alfabético (A-Z)</option>
                  <option value="marca-asc">Marca (A-Z)</option>
                  <option value="categoria-asc">Categoría (A-Z)</option>
                  <option value="codigo-asc">Código</option>
                </select>
                <ChevronDown className="select-chevron" size={15} />
              </label>
            </div>
            <button className="sort-button" onClick={resetFilters} data-testid="button-reset-filters"><RefreshCw size={14} /> Limpiar filtros</button>
            <span className="filter-summary" data-testid="text-filter-summary">{filteredProducts.length.toLocaleString('es-AR')} resultados{orderCount ? ` · ${orderCount} en nota` : ''}</span>
          </div>
        </section>
        <div className="content-layout">
          <section className="catalog-panel" aria-labelledby="catalog-title">
            <div className="list-header"><h2 className="list-title" id="catalog-title">Catálogo de artículos</h2><span className="list-hint">{hasActiveQuery ? `Mostrando ${visibleProducts.length} de ${filteredProducts.length}` : `${products.length} artículos en el catálogo`}</span></div>
             {categoryFilter !== 'all' && (
               <div className="active-category-chip" data-testid="chip-active-category">
                 <span>{categoryFilter}{subcategoryFilter !== 'all' ? ` › ${availableSubcategories.find((item) => item.id === subcategoryFilter)?.label || ''}` : ''}</span>
                 <button onClick={clearCategorySelection} aria-label="Cerrar esta búsqueda" data-testid="button-clear-category"><X size={13} /></button>
               </div>
             )}
             {loading ? <SkeletonGrid /> : loadError ? <div className="state-card" data-testid="error-products"><div className="error-mark"><AlertCircle size={22} /></div><h2>No pudimos cargar el catálogo</h2><p>{loadError} Revisá que los datos estén disponibles e intentá nuevamente.</p><button className="secondary-button" onClick={() => void loadCatalog()} data-testid="button-retry-products"><RefreshCw size={14} /> Reintentar</button></div> : (!hasActiveQuery || browsingSubcategories) ? <CategoryBrowser categories={categorySummaries} expandedCategory={expandedCategory} subcategoriesLoading={subcategoriesLoading} onCategory={chooseCategory} onSubcategory={chooseSubcategory} onBack={() => setExpandedCategory(null)} /> : filteredProducts.length === 0 ? <div className="state-card" data-testid="empty-products"><div className="error-mark"><PackageOpen size={22} /></div><h2>No encontramos artículos</h2><p>Probá con otro código, marca o descripción. También podés quitar los filtros.</p><button className="secondary-button" onClick={resetFilters} data-testid="button-reset-empty"><RefreshCw size={14} /> Restablecer filtros</button></div> : <><div className="product-grid">{visibleProducts.map((product, index) => <article className="product-card" style={{ animationDelay: `${Math.min(index, 12) * 18}ms` }} key={product.codigo} data-testid={`card-product-${product.codigo}`}><div className="product-image"><ProductImage product={product} /><span className="product-code">{product.codigo}</span></div><div className="card-body"><div className="product-type">{product.categoria || 'Sin categoría'}</div><div className="product-name">{product.descripcion}</div><div className="card-footer"><div className="product-price">{compactPrice(getPrice(product, overrides), getCurrency(product))}<span className="currency">{currencyLabel(getCurrency(product))}</span></div><button className={`add-button ${order[product.codigo] ? 'added' : ''}`} onClick={() => addToOrder(product)} aria-label={`Agregar ${product.codigo} a la nota`} data-testid={`button-add-${product.codigo}`}>{order[product.codigo] ? <Check size={14} /> : <Plus size={14} />}<span>{order[product.codigo] ? 'Agregado' : 'Agregar'}</span></button></div><button className="details-button" onClick={() => openSelected(product)} data-testid={`button-detail-${product.codigo}`}>Ver ficha completa</button></div></article>)}</div>{visibleCount < filteredProducts.length && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}><button className="secondary-button" onClick={() => setVisibleCount((count) => count + 48)} data-testid="button-load-more">Cargar 48 más</button></div>}</>}
          </section>
          <OrderPanel lines={lines} note={note} overrides={overrides} onNoteChange={setNote} onQuantity={changeQuantity} onRemove={removeFromOrder} onClear={clearOrder} onDownload={downloadOrder} onCopy={copyOrder} onWhatsApp={sendWhatsApp} />
        </div>
      </main>
      {selected && <ProductDetail product={selected} price={getPrice(selected, overrides)} onClose={closeSelected} onAdd={(product) => { addToOrder(product); closeSelected(); }} onSavePrice={savePrice} />}
      <div className="copy-dock"><button className="secondary-button" onClick={() => void copyOrder()} disabled={!lines.length} data-testid="button-copy-order">{copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar nota</>}</button></div>
      {lines.length > 0 && <button className="mobile-order-jump" onClick={() => document.getElementById('order-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} data-testid="button-jump-order"><ShoppingBag size={14} /> Ver nota · {orderCount}</button>}
      {feedback && <div className="feedback" role="status" aria-live="polite"><ClipboardCheck size={15} /> {feedback}</div>}
    </div>
  );
}

function Router() {
  return <Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath.replace(/\/$/, '')}><ErrorBoundary resetKey={window.location.pathname}><Router /></ErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
