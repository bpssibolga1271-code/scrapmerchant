'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import type { Layer, PathOptions } from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface ProvinceMapData {
  provinceCode: string;
  provinceName: string;
  merchantCount: number;
}

interface IndonesiaMapProps {
  data: ProvinceMapData[];
}

// TODO: Load actual Indonesia province GeoJSON data from a proper source
// (e.g., https://github.com/superpikar/indonesia-geojson or a hosted file).
// The placeholder below includes simplified province boundaries for demonstration.
// Replace this with real GeoJSON data for production use.
const PLACEHOLDER_GEOJSON: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'DKI Jakarta', code: '31' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[106.7, -6.1], [106.9, -6.1], [106.9, -6.3], [106.7, -6.3], [106.7, -6.1]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Jawa Barat', code: '32' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[106.4, -6.2], [108.3, -6.2], [108.3, -7.8], [106.4, -7.8], [106.4, -6.2]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Jawa Tengah', code: '33' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[108.3, -6.5], [111.1, -6.5], [111.1, -8.0], [108.3, -8.0], [108.3, -6.5]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Jawa Timur', code: '35' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[111.1, -6.8], [114.5, -6.8], [114.5, -8.5], [111.1, -8.5], [111.1, -6.8]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Banten', code: '36' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[105.1, -6.0], [106.7, -6.0], [106.7, -7.1], [105.1, -7.1], [105.1, -6.0]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Sumatera Utara', code: '12' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[97.0, 1.0], [100.3, 1.0], [100.3, 3.5], [97.0, 3.5], [97.0, 1.0]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Sulawesi Selatan', code: '73' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[119.3, -3.0], [121.0, -3.0], [121.0, -5.8], [119.3, -5.8], [119.3, -3.0]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Bali', code: '51' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[114.4, -8.0], [115.7, -8.0], [115.7, -8.9], [114.4, -8.9], [114.4, -8.0]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Kalimantan Timur', code: '64' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[115.5, 0.5], [118.0, 0.5], [118.0, -2.0], [115.5, -2.0], [115.5, 0.5]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'DI Yogyakarta', code: '34' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[110.0, -7.5], [110.8, -7.5], [110.8, -8.0], [110.0, -8.0], [110.0, -7.5]]],
      },
    },
  ],
};

function getColor(count: number, maxCount: number): string {
  if (maxCount === 0) return '#f3f4f6';
  const intensity = count / maxCount;
  if (intensity > 0.8) return '#1e40af';
  if (intensity > 0.6) return '#2563eb';
  if (intensity > 0.4) return '#3b82f6';
  if (intensity > 0.2) return '#60a5fa';
  if (intensity > 0) return '#93c5fd';
  return '#dbeafe';
}

function IndonesiaMapInner({ data }: IndonesiaMapProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-medium text-gray-400">Belum ada data</p>
          <p className="mt-1 text-xs text-gray-300">Data akan muncul setelah scraping dilakukan</p>
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.merchantCount), 1);

  const dataMap = new Map(data.map((d) => [d.provinceCode, d]));

  function style(feature: Feature<Geometry, { name: string; code: string }> | undefined): PathOptions {
    const code = feature?.properties?.code ?? '';
    const provinceData = dataMap.get(code);
    const count = provinceData?.merchantCount ?? 0;

    return {
      fillColor: getColor(count, maxCount),
      weight: 1,
      opacity: 1,
      color: '#6b7280',
      fillOpacity: 0.7,
    };
  }

  function onEachFeature(
    feature: Feature<Geometry, { name: string; code: string }>,
    layer: Layer,
  ) {
    const code = feature.properties?.code ?? '';
    const provinceData = dataMap.get(code);
    const count = provinceData?.merchantCount ?? 0;

    layer.bindTooltip(
      `<div class="text-sm">
        <strong>${feature.properties?.name ?? 'Unknown'}</strong><br/>
        Merchants: ${count.toLocaleString()}
      </div>`,
      { sticky: true },
    );
  }

  if (!isMounted) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg bg-gray-100">
        <p className="text-sm text-gray-500">Loading map...</p>
      </div>
    );
  }

  return (
    <MapContainer
      center={[-2.5, 118.0]}
      zoom={5}
      className="h-96 w-full rounded-lg"
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />
      <GeoJSON
        data={PLACEHOLDER_GEOJSON}
        style={style}
        onEachFeature={onEachFeature}
      />
    </MapContainer>
  );
}

export default IndonesiaMapInner;
