export function buildHeadingCone(lat, lng, h) {
  if (h == null) return { type: "FeatureCollection", features: [] };
  const R = 0.00015, sp = 30, toR = (d) => (d * Math.PI) / 180;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [lng, lat],
              [lng + R * Math.sin(toR(h - sp)), lat + R * Math.cos(toR(h - sp))],
              [lng + R * Math.sin(toR(h + sp)), lat + R * Math.cos(toR(h + sp))],
              [lng, lat],
            ],
          ],
        },
      },
    ],
  };
}

export function buildAccuracyFeature(lng, lat) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {},
      },
    ],
  };
}