'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type MapLevel = 'province' | 'regency';
type MapMode = 'choropleth' | 'points';

interface RegionData {
  code: string;
  name: string;
  merchantCount: number;
}

interface MerchantPoint {
  name: string;
  platform: string;
  regionCode: string;
  regionName: string;
  rating?: number | null;
  productCount?: number | null;
  category?: string | null;
}

interface ChoroplethMapProps {
  data: RegionData[];
  merchants?: MerchantPoint[];
  level?: MapLevel;
}

const GEOJSON_URLS: Record<MapLevel, string> = {
  province: '/geojson/sulawesi-provinces.geojson',
  regency: '/geojson/sulteng-regencies.geojson',
};

const MAP_CENTERS: Record<MapLevel, { center: [number, number]; zoom: number }> = {
  province: { center: [121.5, -1.5], zoom: 5.5 },
  regency: { center: [121.0, -1.2], zoom: 6.5 },
};

const CODE_PROP: Record<MapLevel, string> = {
  province: 'KODE_PROV',
  regency: 'KODE_KAB',
};

const NAME_PROP: Record<MapLevel, string> = {
  province: 'PROVINSI',
  regency: 'KABUPATEN',
};

const CHOROPLETH_COLORS = [
  '#fef3c7',
  '#fde68a',
  '#fcd34d',
  '#fbbf24',
  '#f59e0b',
  '#d97706',
  '#b45309',
  '#92400e',
];

const PLATFORM_COLORS: Record<string, string> = {
  tokopedia: '#22c55e',
  shopee: '#f97316',
  blibli: '#3b82f6',
  lazada: '#a855f7',
  grabfood: '#10b981',
  gofood: '#ef4444',
};

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(/[\s-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Seeded PRNG (mulberry32) */
function createRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate random points inside a polygon using rejection sampling. */
function randomPointsInPolygon(
  feature: GeoJSON.Feature,
  count: number,
  seed: number,
): [number, number][] {
  const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  const rings: number[][][] =
    geom.type === 'MultiPolygon'
      ? (geom.coordinates as number[][][][]).map((p) => p[0])
      : [geom.coordinates[0] as number[][]];

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  const rand = createRng(seed);
  const points: [number, number][] = [];
  let attempts = 0;

  while (points.length < count && attempts < count * 20) {
    attempts++;
    const lng = minLng + rand() * (maxLng - minLng);
    const lat = minLat + rand() * (maxLat - minLat);

    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
    }
    if (inside) points.push([lng, lat]); // [lng, lat] for GeoJSON
  }

  return points;
}

// Light basemap style (CartoDB Voyager)
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: 'carto-basemap',
      type: 'raster',
      source: 'carto',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

export default function ChoroplethMap({ data, merchants = [], level: externalLevel }: ChoroplethMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const defaultViewRef = useRef<{ center: maplibregl.LngLat; zoom: number } | null>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const [level, setLevel] = useState<MapLevel>(externalLevel ?? 'regency');
  const [mode, setMode] = useState<MapMode>('choropleth');
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);

  const dataMap = useMemo(() => {
    const map = new Map<string, RegionData>();
    for (const d of data) map.set(d.code, d);
    return map;
  }, [data]);

  const maxCount = useMemo(() => Math.max(...data.map((d) => d.merchantCount), 0), [data]);

  // Group merchants by regionCode
  const merchantsByRegion = useMemo(() => {
    const map = new Map<string, MerchantPoint[]>();
    for (const m of merchants) {
      const arr = map.get(m.regionCode) || [];
      arr.push(m);
      map.set(m.regionCode, arr);
    }
    return map;
  }, [merchants]);

  // Build GeoJSON for points mode (merchants as features)
  const pointsGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!geojson || merchants.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }

    const codeProp = CODE_PROP[level];
    const features: GeoJSON.Feature[] = [];

    for (const feature of geojson.features) {
      const code = feature.properties?.[codeProp]?.toString();
      if (!code) continue;

      const regionMerchants = merchantsByRegion.get(code) || [];
      if (regionMerchants.length === 0) continue;

      const displayMerchants = regionMerchants.slice(0, 200);
      const seed = parseInt(code.replace(/\D/g, ''), 10) || 1;
      const points = randomPointsInPolygon(feature, displayMerchants.length, seed);

      for (let i = 0; i < points.length; i++) {
        const [lng, lat] = points[i];
        const m = displayMerchants[i];
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lng, lat] },
          properties: {
            name: m.name,
            platform: m.platform,
            regionName: m.regionName,
            rating: m.rating ?? null,
            productCount: m.productCount ?? null,
            category: m.category ?? null,
            color: PLATFORM_COLORS[m.platform] || '#f59e0b',
          },
        });
      }
    }

    return { type: 'FeatureCollection', features };
  }, [geojson, merchants, merchantsByRegion, level]);

  // Load GeoJSON
  useEffect(() => {
    setLoading(true);
    fetch(GEOJSON_URLS[level])
      .then((res) => res.json())
      .then((data: GeoJSON.FeatureCollection) => setGeojson(data))
      .catch((err) => console.error('Failed to load GeoJSON:', err))
      .finally(() => setLoading(false));
  }, [level]);

  useEffect(() => {
    if (externalLevel) setLevel(externalLevel);
  }, [externalLevel]);

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const { center, zoom } = MAP_CENTERS[level];
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: center as [number, number],
      zoom,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Store event handler refs for cleanup
  const handlersRef = useRef<Array<{ event: string; layer: string; handler: (...args: unknown[]) => void }>>([]);

  // Update layers when data/mode/geojson change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geojson) return;

    const onStyleLoad = () => {
      // Clean up previous event handlers
      for (const { event, layer, handler } of handlersRef.current) {
        map.off(event as 'mousemove', layer, handler as () => void);
      }
      handlersRef.current = [];

      const codeProp = CODE_PROP[level];
      const nameProp = NAME_PROP[level];
      const isPoints = mode === 'points';

      // Inject merchantCount into GeoJSON features for choropleth
      const enrichedGeo: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: geojson.features.map((f) => {
          const code = f.properties?.[codeProp]?.toString();
          const d = code ? dataMap.get(code) : null;
          return {
            ...f,
            properties: {
              ...f.properties,
              merchantCount: d?.merchantCount ?? 0,
              displayName: titleCase(f.properties?.[nameProp] ?? 'Unknown'),
            },
          };
        }),
      };

      // Remove existing layers/sources
      for (const id of ['region-fill', 'region-line', 'unclustered-point']) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of ['regions', 'merchants']) {
        if (map.getSource(id)) map.removeSource(id);
      }

      // Add region polygons
      map.addSource('regions', { type: 'geojson', data: enrichedGeo });

      // Fill layer (density mode only — skip in points mode so points receive hover)
      if (isPoints) {
        // No fill layer in points mode
      } else {
        // Choropleth fill with data-driven step colors
        const stepSize = maxCount > 0 ? maxCount / CHOROPLETH_COLORS.length : 1;
        // Build step expression: ['step', input, defaultColor, stop1, color1, stop2, color2, ...]
        const stepExpr: unknown[] = ['step', ['get', 'merchantCount'], '#f3f4f6'];
        for (let i = 0; i < CHOROPLETH_COLORS.length; i++) {
          stepExpr.push(i === 0 ? 1 : Math.round(stepSize * i));
          stepExpr.push(CHOROPLETH_COLORS[i]);
        }

        map.addLayer({
          id: 'region-fill',
          type: 'fill',
          source: 'regions',
          paint: {
            'fill-color': maxCount > 0
              ? (stepExpr as maplibregl.ExpressionSpecification)
              : '#f3f4f6',
            'fill-opacity': 0.75,
          },
        });
      }

      // Border line
      map.addLayer({
        id: 'region-line',
        type: 'line',
        source: 'regions',
        paint: {
          'line-color': isPoints ? '#9ca3af' : '#6b7280',
          'line-width': isPoints ? 1.5 : 1,
          'line-opacity': isPoints ? 0.7 : 0.8,
        },
      });

      // Points mode: add clustered merchant points
      if (isPoints && pointsGeoJSON.features.length > 0) {
        map.addSource('merchants', {
          type: 'geojson',
          data: pointsGeoJSON,
        });

        // All points as circles (no clustering)
        map.addLayer({
          id: 'unclustered-point',
          type: 'circle',
          source: 'merchants',
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              5, 3,
              8, 5,
              12, 8,
            ],
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(255,255,255,0.5)',
            'circle-opacity': 0.85,
          },
        });

        // Hover tooltip on points
        const onPointEnter = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          map.getCanvas().style.cursor = 'pointer';
          if (!e.features?.length) return;
          const f = e.features[0];
          const props = f.properties!;
          const coords = (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number];

          let html = `<strong>${props.name}</strong><br/>`;
          html += `<span style="color:${props.color}">${props.platform}</span>`;
          if (props.rating) html += ` · ★ ${Number(props.rating).toFixed(1)}`;
          if (props.productCount) html += `<br/>${props.productCount} produk`;
          if (props.category) html += `<br/>${props.category}`;
          html += `<br/><span style="color:#9ca3af">${props.regionName}</span>`;

          if (popupRef.current) popupRef.current.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 8 })
            .setLngLat(coords)
            .setHTML(html)
            .addTo(map);
        };

        const onPointLeave = () => {
          map.getCanvas().style.cursor = '';
          popupRef.current?.remove();
        };

        // Click point: zoom & pan to it. Click same point: reset. Click different point: pan to new one.
        const ZOOM_TARGET = 11;
        let focusedPointName: string | null = null;

        const onPointClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          if (!e.features?.length) return;
          const props = e.features[0].properties!;
          const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
          const clickedName = `${props.name}|${coords[0]}|${coords[1]}`;

          if (focusedPointName === clickedName) {
            // Same point clicked — reset to default view
            resetViewRef.current?.();
            focusedPointName = null;
          } else {
            // Different point or first click — save default view if not yet saved, then zoom
            if (!defaultViewRef.current) {
              defaultViewRef.current = { center: map.getCenter(), zoom: map.getZoom() };
            }
            map.easeTo({ center: coords, zoom: ZOOM_TARGET, duration: 500 });
            focusedPointName = clickedName;
          }
        };

        map.on('mouseenter', 'unclustered-point', onPointEnter);
        map.on('mouseleave', 'unclustered-point', onPointLeave);
        map.on('click', 'unclustered-point', onPointClick);
        handlersRef.current.push(
          { event: 'mouseenter', layer: 'unclustered-point', handler: onPointEnter as unknown as (...args: unknown[]) => void },
          { event: 'mouseleave', layer: 'unclustered-point', handler: onPointLeave as unknown as (...args: unknown[]) => void },
          { event: 'click', layer: 'unclustered-point', handler: onPointClick as unknown as (...args: unknown[]) => void },
        );
      }

      // Choropleth hover tooltip (density mode only - no polygon hover in points mode)
      if (!isPoints) {
        const onRegionMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          if (!e.features?.length) return;
          map.getCanvas().style.cursor = 'pointer';
          const props = e.features[0].properties!;
          const name = props.displayName || 'Unknown';
          const count = props.merchantCount ?? 0;
          setHoveredRegion(name);

          if (popupRef.current) popupRef.current.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: false, offset: 8 })
            .setLngLat(e.lngLat)
            .setHTML(`<strong>${name}</strong><br/>${Number(count).toLocaleString()} merchants`)
            .addTo(map);
        };

        const onRegionLeave = () => {
          map.getCanvas().style.cursor = '';
          setHoveredRegion(null);
          popupRef.current?.remove();
        };

        map.on('mousemove', 'region-fill', onRegionMove);
        map.on('mouseleave', 'region-fill', onRegionLeave);
        handlersRef.current.push(
          { event: 'mousemove', layer: 'region-fill', handler: onRegionMove as unknown as (...args: unknown[]) => void },
          { event: 'mouseleave', layer: 'region-fill', handler: onRegionLeave as unknown as (...args: unknown[]) => void },
        );
      }

      // Fit bounds
      const bounds = new maplibregl.LngLatBounds();
      for (const f of enrichedGeo.features) {
        const geom = f.geometry;
        const addCoords = (coords: number[][]) => {
          for (const [lng, lat] of coords) bounds.extend([lng, lat]);
        };
        if (geom.type === 'Polygon') {
          addCoords(geom.coordinates[0]);
        } else if (geom.type === 'MultiPolygon') {
          for (const poly of geom.coordinates) addCoords(poly[0]);
        }
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 30, duration: 500 });
        // Store the default view after fitBounds completes
        map.once('moveend', () => {
          defaultViewRef.current = { center: map.getCenter(), zoom: map.getZoom() };
        });
      }

      // Reset view function
      resetViewRef.current = () => {
        if (defaultViewRef.current) {
          map.easeTo({ center: defaultViewRef.current.center, zoom: defaultViewRef.current.zoom, duration: 500 });
        }
      };
    };

    if (map.isStyleLoaded()) {
      onStyleLoad();
    } else {
      map.once('load', onStyleLoad);
    }

    return () => {
      popupRef.current?.remove();
    };
  }, [geojson, dataMap, maxCount, level, mode, pointsGeoJSON]);

  const levelLabel = level === 'province' ? 'Provinsi' : 'Kabupaten/Kota';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            Merchant Distribution — {levelLabel}
            {hoveredRegion && (
              <Badge variant="secondary" className="ml-2">{hoveredRegion}</Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Mode selector */}
            <div className="flex rounded-md border border-gray-200 text-xs overflow-hidden">
              <button
                onClick={() => setMode('choropleth')}
                className={`px-2.5 py-1 transition-colors ${
                  mode === 'choropleth'
                    ? 'bg-amber-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Density
              </button>
              <button
                onClick={() => setMode('points')}
                className={`px-2.5 py-1 transition-colors ${
                  mode === 'points'
                    ? 'bg-amber-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Points
              </button>
            </div>
            {/* Level selector */}
            <div className="flex rounded-md border border-gray-200 text-xs overflow-hidden">
              <button
                onClick={() => setLevel('regency')}
                className={`px-2.5 py-1 transition-colors ${
                  level === 'regency'
                    ? 'bg-amber-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Kab/Kota
              </button>
              <button
                onClick={() => setLevel('province')}
                className={`px-2.5 py-1 transition-colors ${
                  level === 'province'
                    ? 'bg-amber-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Provinsi
              </button>
            </div>
            {/* Legend */}
            {mode === 'choropleth' && data.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <span>0</span>
                <div className="flex h-3">
                  {CHOROPLETH_COLORS.map((color, i) => (
                    <div key={i} className="w-4" style={{ backgroundColor: color }} />
                  ))}
                </div>
                <span>{maxCount.toLocaleString()}</span>
              </div>
            )}
            {/* Platform legend for points mode */}
            {mode === 'points' && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {Object.entries(PLATFORM_COLORS).map(([name, color]) => (
                  <div key={name} className="flex items-center gap-1">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                    <span>{name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
            <span className="text-sm text-gray-500">Loading map...</span>
          </div>
        )}
        <div ref={mapContainerRef} className="h-[420px] w-full" />
        {/* Reset zoom button */}
        <button
          onClick={() => resetViewRef.current?.()}
          className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 shadow-md border border-gray-200 hover:bg-gray-50 transition-colors"
          title="Reset zoom"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
          </svg>
          Reset
        </button>
      </CardContent>
    </Card>
  );
}
