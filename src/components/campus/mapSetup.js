import maplibregl from "maplibre-gl";

export function initMap(container) {
  const map = new maplibregl.Map({
    container,
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [78.0035, 30.269],
    zoom: 17,
    pitch: 0,
    bearing: 0,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  return map;
}

export function setupMapLayers(map) {
  const addSrc = (id) =>
    map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  addSrc("accuracy-src");
  map.addLayer({
    id: "accuracy-fill",
    type: "circle",
    source: "accuracy-src",
    paint: {
      "circle-color": "rgba(66,133,244,0.12)",
      "circle-stroke-color": "rgba(66,133,244,0.45)",
      "circle-stroke-width": 1.5,
      "circle-pitch-alignment": "map",
      "circle-radius": { stops: [[14, 8], [16, 20], [18, 80], [20, 320]] },
    },
  });

  addSrc("heading-src");
  map.addLayer({
    id: "heading-cone",
    type: "fill",
    source: "heading-src",
    paint: {
      "fill-color": "rgba(66,133,244,0.25)",
      "fill-outline-color": "rgba(66,133,244,0.5)",
    },
  });

  addSrc("edges");
  map.addLayer({
    id: "edges-layer",
    type: "line",
    source: "edges",
    paint: { "line-color": "#666", "line-width": 1.5, "line-opacity": 0.35 },
  });

  addSrc("route-travelled");
  map.addLayer({
    id: "route-travelled-layer",
    type: "line",
    source: "route-travelled",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#aaaaaa", "line-width": 7, "line-opacity": 0.55, "line-blur": 1 },
  });

  addSrc("route-src");
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route-src",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#1a56c4", "line-width": 13, "line-opacity": 0.85 },
  });
  map.addLayer({
    id: "route-fill",
    type: "line",
    source: "route-src",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#4285F4", "line-width": 7, "line-opacity": 1 },
  });

  addSrc("arrows-src");
  map.addLayer({
    id: "route-arrows",
    type: "symbol",
    source: "arrows-src",
    layout: {
      "text-field": "▶",
      "text-size": 13,
      "text-rotate": ["get", "bearing"],
      "text-rotation-alignment": "map",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#1a56c4",
      "text-halo-width": 1.5,
      "text-opacity": 0.9,
    },
  });

  addSrc("uturn-src");
  map.addLayer({
    id: "uturn-layer",
    type: "symbol",
    source: "uturn-src",
    layout: {
      "text-field": "↩",
      "text-size": 28,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#ea4335", "text-halo-color": "#fff", "text-halo-width": 2 },
  });
}